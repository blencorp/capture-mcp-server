import { Code, Function, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';
import { CfnOutput, Duration, PhysicalName, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ApiMapping, CorsHttpMethod, DomainName, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { ApiGatewayv2DomainProperties } from 'aws-cdk-lib/aws-route53-targets';

/**
 * Properties for the ServerlessStack
 */
export interface ServerlessStackProps extends StackProps {
  /**
   * Custom domain name for the API (optional)
   * Example: "mcp.example.com"
   * If set, the stack will look up the Route53 hosted zone for the root domain
   * and create an ACM certificate automatically.
   */
  domainName?: string;

  /**
   * Environment name
   * Example: "dev", "prod"
   */
  environment: string;
}

/**
 * Serverless Stack for Capture MCP Server
 * 
 * Creates a "dirt cheap" deployment using:
 * - API Gateway HTTP API (cheaper than REST API)
 * - Lambda function with Powertools instrumentation
 * - S3 bucket for API key storage
 * - Optional custom domain with automatic Route53 and ACM setup
 */
export class ServerlessStack extends Stack {
  /** The API Gateway HTTP API */
  public readonly httpApi: HttpApi;

  /** The Lambda function */
  public readonly lambdaFunction: Function;

  /** The S3 bucket for API keys */
  public readonly apiKeyBucket: Bucket;

  constructor(scope: Construct, id: string, props?: ServerlessStackProps) {
    super(scope, id, props);

    // =========================================================================
    // S3 Bucket for API Keys
    // =========================================================================
    const isDev = props?.environment === 'dev';
    
    this.apiKeyBucket = new Bucket(this, 'ApiKeyBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false, // Not needed for API keys
      removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: isDev, // Required for DESTROY to work on non-empty buckets
      lifecycleRules: [
        {
          // Clean up incomplete multipart uploads
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
    });

    // =========================================================================
    // Lambda Function
    // =========================================================================
    
    // Path to the compiled Lambda code (relative to infrastructure/)
    const lambdaCodePath = path.join(__dirname, '../../dist');

    // Create a log group with retention policy
    const logGroup = new LogGroup(this, 'McpHandlerLogGroup', {
      logGroupName: '/aws/lambda/capture-mcp-server',
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    // AWS Lambda Powertools for TypeScript layer
    // https://docs.aws.amazon.com/powertools/typescript/latest/getting-started/lambda-layers/
    const powertoolsLayer = LayerVersion.fromLayerVersionArn(
      this,
      'PowertoolsLayer',
      `arn:aws:lambda:${this.region}:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:41`
    );

    this.lambdaFunction = new Function(this, 'McpHandler', {
      functionName: 'capture-mcp-server',
      description: 'Capture MCP Server - Federal procurement data access via MCP protocol',
      runtime: Runtime.NODEJS_20_X,
      handler: 'lambda-handler.handler',
      code: Code.fromAsset(lambdaCodePath),
      memorySize: 512,
      timeout: Duration.seconds(30),
      logGroup,
      layers: [powertoolsLayer],
      environment: {
        // Powertools configuration
        POWERTOOLS_SERVICE_NAME: 'capture-mcp-server',
        POWERTOOLS_LOG_LEVEL: 'INFO',
        POWERTOOLS_METRICS_NAMESPACE: 'CaptureMCP',
        // API Key bucket configuration
        API_KEY_BUCKET: this.apiKeyBucket.bucketName,
        API_KEY_PREFIX: 'api-keys/',
        // Node.js configuration
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    // Grant Lambda read access to the API key bucket
    this.apiKeyBucket.grantRead(this.lambdaFunction);

    // Add specific S3 permissions for HeadObject (for metadata reads)
    this.lambdaFunction.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:HeadObject'],
      resources: [this.apiKeyBucket.arnForObjects('api-keys/*')],
    }));

    // =========================================================================
    // HTTP API Gateway
    // =========================================================================
    this.httpApi = new HttpApi(this, 'HttpApi', {
      apiName: 'capture-mcp-api',
      description: 'Capture MCP Server HTTP API',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.POST, CorsHttpMethod.GET, CorsHttpMethod.OPTIONS],
        allowHeaders: [
          'Content-Type',
          'Accept',
          'X-Api-Key',
          'X-Sam-Api-Key',
          'X-Tango-Api-Key',
        ],
        maxAge: Duration.hours(1),
      },
    });

    // Lambda integration
    const lambdaIntegration = new HttpLambdaIntegration('LambdaIntegration', this.lambdaFunction);

    // Add routes
    // Health check endpoint
    this.httpApi.addRoutes({
      path: '/health',
      methods: [HttpMethod.GET],
      integration: lambdaIntegration,
    });

    // MCP endpoint - accepts POST requests
    this.httpApi.addRoutes({
      path: '/mcp',
      methods: [HttpMethod.POST],
      integration: lambdaIntegration,
    });

    // Catch-all for other MCP paths if needed
    this.httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: lambdaIntegration,
    });

    // =========================================================================
    // Custom Domain with Route53 (Optional)
    // =========================================================================
    if (props?.domainName) {
      // Look up the hosted zone
      const hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
        domainName: props.domainName,
      });

      // Create ACM certificate with DNS validation
      const certificate = new Certificate(this, 'Certificate', {
        domainName: props.domainName,
        validation: CertificateValidation.fromDns(hostedZone),
      });

      // Create the custom domain
      const customDomain = new DomainName(this, 'DomainName', {
        domainName: props.domainName,
        certificate,
      });

      // Map the API to the custom domain
      new ApiMapping(this, 'ApiMapping', {
        api: this.httpApi,
        domainName: customDomain,
      });

      // Create Route53 A record pointing to the API Gateway
      new ARecord(this, 'AliasRecord', {
        zone: hostedZone,
        recordName: props.domainName,
        target: RecordTarget.fromAlias(
          new ApiGatewayv2DomainProperties(
            customDomain.regionalDomainName,
            customDomain.regionalHostedZoneId
          )
        ),
      });

    }

    // =========================================================================
    // Stack Outputs
    // =========================================================================
    const baseUrl = props?.domainName ? `https://${props.domainName}/` : this.httpApi.url!;

    new CfnOutput(this, 'ApiUrl', {
      value: baseUrl,
      description: 'API Gateway URL for the MCP server',
      exportName: 'CaptureMcpApiUrl',
    });

    new CfnOutput(this, 'McpEndpoint', {
      value: `${baseUrl}mcp`,
      description: 'MCP protocol endpoint URL',
      exportName: 'CaptureMcpEndpoint',
    });

    new CfnOutput(this, 'HealthEndpoint', {
      value: `${baseUrl}health`,
      description: 'Health check endpoint URL',
      exportName: 'CaptureMcpHealthEndpoint',
    });

    new CfnOutput(this, 'ApiKeyBucketName', {
      value: this.apiKeyBucket.bucketName,
      description: 'S3 bucket name for API key storage',
      exportName: 'CaptureMcpApiKeyBucket',
    });

    new CfnOutput(this, 'LambdaFunctionName', {
      value: this.lambdaFunction.functionName,
      description: 'Lambda function name',
      exportName: 'CaptureMcpLambdaFunction',
    });

    new CfnOutput(this, 'LambdaFunctionArn', {
      value: this.lambdaFunction.functionArn,
      description: 'Lambda function ARN',
      exportName: 'CaptureMcpLambdaArn',
    });
  }
}
