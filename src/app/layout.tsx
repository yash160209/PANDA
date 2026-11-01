import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "PANDA — A little more connected",
  description: "A thoughtful place to keep up with your people and the moments that matter.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Script id="panda-theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem("panda-theme");if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t}else{delete document.documentElement.dataset.theme}}catch{}`}
        </Script>
      </body>
    </html>
  );
}
