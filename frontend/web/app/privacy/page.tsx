import Script from "next/script";

export default function PrivacyPage() {
  return (
    <>
      <div id="usrly-privacy-policy" data-domain="onconnect.one" />
      <Script
        src="https://usrly-five.vercel.app/script.js"
        strategy="afterInteractive"
      />
    </>
  );
}
