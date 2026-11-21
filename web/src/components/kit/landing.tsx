import { ArrowRight, BookOpen } from 'lucide-react';
import { brand } from '@/brand';
import { Button } from '@/components/ui/button';
import { CopyField } from '@/components/kit/copy-field';
import { Page } from '@/components/kit/page';
import { useSignedIn } from '@/components/kit/use-signed-in';

const container = 'mx-auto grid max-w-5xl gap-6 px-4 py-12';
const h2 = 'text-2xl font-semibold tracking-tight';

/**
 * The home page: what the server does, how to connect an assistant, what to ask, where the
 * data comes from, and how it works. All content comes from `@/brand`.
 */
export function Landing({ accountUrl, publicUrl }: { accountUrl: string; publicUrl?: string }) {
  const signedIn = useSignedIn();
  return (
    <Page>
      <section aria-labelledby="hero-title" className="border-b">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-14 sm:py-20">
          <h1
            id="hero-title"
           
            className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl"
          >
            {brand.tagline}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-lg">{brand.summary}</p>
          <div className="flex flex-wrap gap-3">
            {brand.accounts !== false && (
              <Button asChild size="lg">
                <a href={signedIn ? '/account' : '/sign-in?next=%2Faccount'}>
                  {signedIn ? 'Go to your account' : 'Create an account or sign in'}
                  <ArrowRight />
                </a>
              </Button>
            )}
            <Button asChild size="lg" variant={brand.accounts === false ? 'default' : 'outline'}>
              <a href={brand.docsUrl}>
                <BookOpen />
                Read the docs
              </a>
            </Button>
          </div>
          {brand.repoUrl && (
            <p className="text-muted-foreground text-sm">
              Open source ({brand.license}).{' '}
              <a href={brand.repoUrl} className="hover:text-foreground underline underline-offset-4">
                Source code on GitHub
              </a>
              .
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="connect-title">
        <div className={container}>
          <h2 id="connect-title" className={h2}>
            Connect your AI assistant
          </h2>
          <ol className="grid gap-6 md:grid-cols-3">
            <li className="grid content-start gap-3">
              <h3 className="font-medium">1. Copy the server URL</h3>
              <CopyField value={accountUrl} label="the server URL" />
            </li>
            <li className="grid content-start gap-3">
              <h3 className="font-medium">2. Add it to your assistant</h3>
              <p className="text-muted-foreground text-sm">
                Add it as a custom connector (remote MCP server) in Claude, ChatGPT, Cursor, VS Code or another
                assistant.{' '}
                <a href={brand.connect.guidesHref} className="text-foreground underline underline-offset-4">
                  Step-by-step guides
                </a>
                .
              </p>
            </li>
            <li className="grid content-start gap-3">
              <h3 className="font-medium">3. {brand.accounts === false ? 'Authorize when asked' : 'Sign in when asked'}</h3>
              <p className="text-muted-foreground text-sm">{brand.connect.signInStep}</p>
            </li>
          </ol>
          {publicUrl && brand.connect.publicNote && (
            <div className="grid gap-3 rounded-lg border p-4">
              <h3 className="font-medium">Without an account</h3>
              <p className="text-muted-foreground text-sm">{brand.connect.publicNote}</p>
              <CopyField value={publicUrl} label="the no-account URL" />
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="examples-title" className="border-t">
        <div className={container}>
          <h2 id="examples-title" className={h2}>
            What you can ask
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {brand.examples.map((example) => (
              <li key={example.title} className="bg-card grid content-start gap-2 rounded-lg border p-4">
                <h3 className="text-sm font-medium">{example.title}</h3>
                <p className="text-muted-foreground text-sm">“{example.prompt}”</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="sources-title" className="border-t">
        <div className={container}>
          <h2 id="sources-title" className={h2}>
            Data sources
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {brand.sources.map((source) => (
              <li key={source.name} className="grid content-start gap-1">
                <h3 className="font-medium">
                  {source.href ? (
                    <a href={source.href} className="underline underline-offset-4">
                      {source.name}
                    </a>
                  ) : (
                    source.name
                  )}
                </h3>
                <p className="text-muted-foreground text-sm">{source.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="how-title" className="border-t">
        <div className={container}>
          <h2 id="how-title" className={h2}>
            How it works
          </h2>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {brand.howItWorks.map((point) => (
              <li key={point.title} className="grid content-start gap-1">
                <h3 className="font-medium">{point.title}</h3>
                <p className="text-muted-foreground text-sm">{point.body}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm">
            <a href={brand.howItWorksHref} className="underline underline-offset-4">
              Read how it works in the docs
            </a>
          </p>
        </div>
      </section>
    </Page>
  );
}
