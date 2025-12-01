import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ServerlessStack } from '../lib/serverless-stack';

describe('ServerlessStack', () => {
  let app: App;
  let stack: ServerlessStack;
  let template: Template;

  // Synthesize once and reuse - CDK synthesis is expensive (~1.5s per stack)
  beforeAll(() => {
    app = new App();
    stack = new ServerlessStack(app, 'TestStack', {
      environment: 'dev',
      env: {
        account: '123456789012',
        region: 'us-east-1',
      },
    });
    template = Template.fromStack(stack);
  });

  describe('S3 Bucket', () => {
    it('creates an S3 bucket for API keys', () => {
      template.resourceCountIs('AWS::S3::Bucket', 1);
    });

    it('enables S3-managed encryption', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
      });
    });

    it('blocks all public access', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    it('has lifecycle rule for incomplete multipart uploads', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              AbortIncompleteMultipartUpload: {
                DaysAfterInitiation: 1,
              },
              Status: 'Enabled',
            }),
          ]),
        },
      });
    });
  });

  describe('Lambda Function', () => {
    it('creates the MCP handler Lambda function', () => {
      // Note: dev environment also creates an auto-delete S3 custom resource Lambda
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'capture-mcp-server',
      });
    });

    it('uses Node.js 20 runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
      });
    });

    it('has correct function name', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'capture-mcp-server',
      });
    });

    it('has correct handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'lambda-handler.handler',
      });
    });

    it('has 512 MB memory', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 512,
      });
    });

    it('has 30 second timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 30,
      });
    });

    it('has Powertools environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            POWERTOOLS_SERVICE_NAME: 'capture-mcp-server',
            POWERTOOLS_LOG_LEVEL: 'INFO',
            POWERTOOLS_METRICS_NAMESPACE: 'CaptureMCP',
          }),
        },
      });
    });

    it('has API key bucket environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            API_KEY_PREFIX: 'api-keys/',
          }),
        },
      });
    });

    it('has Powertools layer attached', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Layers: Match.arrayWith([
          Match.stringLikeRegexp('arn:aws:lambda:us-east-1:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:'),
        ]),
      });
    });
  });

  describe('Lambda IAM Permissions', () => {
    it('has S3 read permissions for API key bucket', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['s3:GetObject*', 's3:GetBucket*', 's3:List*']),
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('has S3 HeadObject permission for API key bucket', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 's3:HeadObject',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  describe('CloudWatch Log Group', () => {
    it('creates a log group', () => {
      template.resourceCountIs('AWS::Logs::LogGroup', 1);
    });

    it('has correct log group name', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/lambda/capture-mcp-server',
      });
    });

    it('has 30-day retention', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 30,
      });
    });
  });

  describe('HTTP API Gateway', () => {
    it('creates an HTTP API', () => {
      template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    });

    it('has correct API name', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
        Name: 'capture-mcp-api',
      });
    });

    it('has CORS configuration', () => {
      template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
        CorsConfiguration: {
          AllowHeaders: Match.arrayWith([
            'Content-Type',
            'Accept',
            'X-Api-Key',
            'X-Sam-Api-Key',
            'X-Tango-Api-Key',
          ]),
          AllowMethods: ['POST', 'GET', 'OPTIONS'],
          AllowOrigins: ['*'],
          MaxAge: 3600,
        },
      });
    });

    it('creates routes for health, mcp, and catch-all', () => {
      // Health route
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'GET /health',
      });

      // MCP route
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'POST /mcp',
      });

      // Catch-all route
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: 'ANY /{proxy+}',
      });
    });

    it('creates a Lambda integration', () => {
      template.resourceCountIs('AWS::ApiGatewayV2::Integration', 1);
      template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
        IntegrationType: 'AWS_PROXY',
        PayloadFormatVersion: '2.0',
      });
    });
  });

  describe('Stack Outputs', () => {
    it('exports API URL', () => {
      template.hasOutput('ApiUrl', {
        Export: {
          Name: 'CaptureMcpApiUrl',
        },
      });
    });

    it('exports MCP endpoint', () => {
      template.hasOutput('McpEndpoint', {
        Export: {
          Name: 'CaptureMcpEndpoint',
        },
      });
    });

    it('exports health endpoint', () => {
      template.hasOutput('HealthEndpoint', {
        Export: {
          Name: 'CaptureMcpHealthEndpoint',
        },
      });
    });

    it('exports API key bucket name', () => {
      template.hasOutput('ApiKeyBucketName', {
        Export: {
          Name: 'CaptureMcpApiKeyBucket',
        },
      });
    });

    it('exports Lambda function name', () => {
      template.hasOutput('LambdaFunctionName', {
        Export: {
          Name: 'CaptureMcpLambdaFunction',
        },
      });
    });

    it('exports Lambda function ARN', () => {
      template.hasOutput('LambdaFunctionArn', {
        Export: {
          Name: 'CaptureMcpLambdaArn',
        },
      });
    });
  });

  describe('Environment-specific behavior', () => {
    describe('dev environment', () => {
      it('sets bucket removal policy to DESTROY', () => {
        // In dev, the bucket should have autoDeleteObjects enabled via custom resource
        template.resourceCountIs('Custom::S3AutoDeleteObjects', 1);
      });
    });

    describe('prod environment', () => {
      let prodTemplate: Template;

      beforeAll(() => {
        const prodApp = new App();
        const prodStack = new ServerlessStack(prodApp, 'ProdTestStack', {
          environment: 'prod',
          env: {
            account: '123456789012',
            region: 'us-east-1',
          },
        });
        prodTemplate = Template.fromStack(prodStack);
      });

      it('does not have auto-delete objects in prod', () => {
        prodTemplate.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
      });
    });
  });

  describe('Public properties', () => {
    it('exposes httpApi', () => {
      expect(stack.httpApi).toBeDefined();
    });

    it('exposes lambdaFunction', () => {
      expect(stack.lambdaFunction).toBeDefined();
    });

    it('exposes apiKeyBucket', () => {
      expect(stack.apiKeyBucket).toBeDefined();
    });
  });
});
