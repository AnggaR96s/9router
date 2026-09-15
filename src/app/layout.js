import { Inter, Montserrat, Space_Mono } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import "material-symbols/outlined.css";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import "@/lib/network/initOutboundProxy"; // Auto-initialize outbound proxy env
import "@/shared/services/bootstrap"; // Auto-run initializeApp (watchdog, auto-resume tunnel)
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";

// Hook console immediately at module load time (server-side only, runs once)
initConsoleLogCapture();

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// Neubrutalist typefaces. Loaded unconditionally (small, and next/font inlines
// them into the build) so switching the visual theme needs no network at
// runtime; they are only *used* inside the [data-visual="neubrutalist"] block.
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat" });
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
});

export const metadata = {
  title: "9Router - AI Infrastructure Management",
  description: "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Theme bootstrap, in two parts — the order matters.

            1. The gate. This script sits after Next's stylesheet <link>, and an
               inline script does not execute until the stylesheets ahead of it
               finish parsing. For those first frames the document is therefore
               styled with the *default* theme and no [data-visual], which is the
               flash on reload this guards against. The gate keeps the body
               unpainted until part 2 has run. <noscript> lifts it when JS is off.

            2. The bootstrap. Mirrors the zustand-persist "theme" key, the `dark`
               class applyTheme() sets, and the data-visual attribute the
               visual-theme axis sets, then marks the document ready to paint.
               The marker is set outside the try/catch so a corrupt localStorage
               value can never leave the gate closed. */}
        <style
          dangerouslySetInnerHTML={{
            __html: "html:not([data-theme-ready]) body{visibility:hidden}",
          }}
        />
        <noscript>
          <style
            dangerouslySetInnerHTML={{
              __html: "html body{visibility:visible!important}",
            }}
          />
        </noscript>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var r=document.documentElement;try{var s=localStorage.getItem('theme');var st=s?(JSON.parse(s).state||{}):{};var t=st.theme||'system';var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(t==='system'&&m)){r.classList.add('dark')}var v=st.visualTheme;if(v&&v!=='default'){r.setAttribute('data-visual',v)}}catch(e){}r.setAttribute('data-theme-ready','')})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `var d=document,r=d.documentElement,f=function(){r.classList.add('fonts-loaded')};if(d.fonts&&d.fonts.load){d.fonts.load('24px "Material Symbols Outlined"').then(f).catch(f);setTimeout(f,3000)}else{f()}`,
          }}
        />
      </head>
      <body className={`${inter.variable} ${montserrat.variable} ${spaceMono.variable} font-sans antialiased`}>
        <ThemeProvider>
          <RuntimeI18nProvider>
            {children}
          </RuntimeI18nProvider>
        </ThemeProvider>
        <GoogleAnalytics gaId={"G-LC959F603F"} />
      </body>
    </html>
  );
}
