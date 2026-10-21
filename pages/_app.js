import Head from 'next/head'
import '../styles/globals.css'
export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        {/* viewport-fit=cover lets the installed app draw under the iPhone notch; the header and
            bottom bar pad themselves with env(safe-area-inset-*). */}
        <meta key="viewport" name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <Component {...pageProps} />
    </>
  )
}
