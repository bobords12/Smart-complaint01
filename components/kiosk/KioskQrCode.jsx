import { QRCodeSVG } from "qrcode.react";

/**
 * Kiosk QR code.
 *
 * Rendered with qrcode.react (a maintained, spec-compliant encoder) rather
 * than an in-house one. Two earlier problems are gone by construction:
 * the symbol is guaranteed to be a valid ISO/IEC 18004 code that an
 * ordinary phone camera reads, and there is no encoder that can silently
 * drift out of sync with the specification.
 *
 * Nothing is fetched over the network to draw it, so the kiosk keeps
 * working with the kiosk PC offline, and the token inside the code is
 * never sent to a third-party image service.
 *
 * The QR carries a capability and nothing else. Neither the evidence
 * code nor the status code embeds a name, a mobile number, an address,
 * a narrative, or a sequential database id: they are unguessable
 * random tokens whose digests are what the database stores.
 */
export default function KioskQrCode({ value, label, size = 208, className = "" }) {
  // An empty value would encode as a valid-looking but useless symbol,
  // which is worse than no code at all, so it is refused outright.
  if (!value) {
    return (
      <p className="text-[13px] text-critical">
        The QR code could not be generated. Please ask staff for assistance.
      </p>
    );
  }

  return (
    <QRCodeSVG
      value={value}
      size={size}
      // Level M: coarse enough modules to stay readable on a glossy
      // touchscreen at this size, while tolerating fingerprints and glare.
      level="M"
      bgColor="#ffffff"
      fgColor="#0E2F5C"
      // The spec requires a 4-module light margin; without it many
      // scanners refuse the symbol entirely.
      marginSize={4}
      title={label}
      className={`rounded-[10px] ${className}`}
    />
  );
}
