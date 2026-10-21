import Head from 'next/head'

export default function GlobalStyles() {
  return (
    <Head>
      <title>doddl PM</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        :root { --indigo: #3D157D; --aqua: #30BEAA; --bg: #F5F6FA; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Nunito', sans-serif; background: var(--bg); color: #172b4d; }
        input, select, textarea, button { font-family: 'Nunito', sans-serif; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: #dfe1e6; border-radius: 3px; }
        html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
        body { -webkit-tap-highlight-color: rgba(61, 21, 125, 0.08); }
        /* Phone: 16px text in form fields stops iOS zooming the page when one is tapped */
        @media (max-width: 767px) {
          input:not([type="checkbox"]):not([type="radio"]), select, textarea { font-size: 16px !important; }
        }
        /* Sideways-scrolling strips (tabs, kanban, timelines) without a visible bar on phones */
        .scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
        .scroll-x::-webkit-scrollbar { display: none; }
      `}</style>
    </Head>
  )
}
