import QRCode from "qrcode";

/**
 * ILUSTRAÇÃO de uma placa DirectPlaca (não é foto): moldura, QR Code real,
 * indicação de NFC e o código individual. O QR contém só um texto de exemplo
 * (não leva a nenhum site). A arte real de cada placa segue o template escolhido.
 */
export async function PlateIllustration({ code = "A7K482", className = "" }: { code?: string; className?: string }) {
  const svg = await QRCode.toString("DirectPlaca — exemplo ilustrativo de placa", {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: "#0d1a2a", light: "#ffffff" },
  });
  return (
    <figure className={`landing-plate ${className}`} aria-label="Ilustração de uma placa DirectPlaca com QR Code, NFC e código individual">
      <div className="landing-plate-card">
        <p className="landing-plate-eyebrow">Aponte a câmera ou aproxime o celular</p>
        <div className="landing-plate-qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="landing-plate-foot">
          <span className="landing-plate-nfc" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M8.5 7.5a6.5 6.5 0 0 1 0 9M12 5a10 10 0 0 1 0 14M5 10a2.5 2.5 0 0 1 0 4" />
            </svg>
            NFC
          </span>
          <span className="landing-plate-code">{code}</span>
        </div>
      </div>
    </figure>
  );
}
