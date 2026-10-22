import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" href="/favicon.ico?v=splat" sizes="any" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png?v=splat" />
        {/* App icon = the doddl splat (white on brand purple). ?v= busts phones' icon caches when it changes.
            iOS rounds the corners itself and paints transparent ones black: full-bleed 180px icon. */}
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=splat" />
        {/* Installable app (Add to Home Screen / Install): opens full screen, no browser bars */}
        <link rel="manifest" href="/manifest.webmanifest?v=splat" />
        <meta name="theme-color" content="#3D157D" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="doddl PM" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
