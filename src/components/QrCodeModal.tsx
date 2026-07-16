import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { X, QrCode, Smartphone, Check, Copy } from "lucide-react";

interface QrCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  url: string;
}

export default function QrCodeModal({ isOpen, onClose, url }: QrCodeModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen && canvasRef.current && url) {
      QRCode.toCanvas(
        canvasRef.current,
        url,
        {
          width: 256,
          margin: 2,
          color: {
            dark: "#0a0a0c", // bento-bg
            light: "#ffffff",
          },
        },
        (error) => {
          if (error) console.error("Error generating QR code:", error);
        }
      );
    }
  }, [isOpen, url]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="relative w-full max-w-md overflow-hidden bg-bento-card border border-bento-border rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-bento-border">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-bento-accent" />
            <h3 className="font-semibold text-bento-text">Connect Mobile Player</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-bento-muted hover:text-bento-text bg-bento-bg/50 border border-bento-border/50 hover:bg-bento-border rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col items-center p-6 text-center">
          <p className="text-sm text-bento-text/90 mb-6 leading-relaxed">
            Scan this QR code with your smartphone to open the <span className="text-bento-accent font-semibold">Mobile Audio Engine</span>. 
            Put on your headphones (like Pixel Buds Pro 2) to experience immersive spatial audio with head tracking!
          </p>

          {/* QR Code Container */}
          <div className="p-4 bg-white rounded-xl shadow-inner mb-6">
            <canvas ref={canvasRef} className="block w-48 h-48 sm:w-56 sm:h-56" />
          </div>

          {/* Alternative Link */}
          <div className="w-full text-left">
            <label className="block text-xs font-mono font-bold uppercase text-bento-muted mb-1.5">
              Or copy the link manually
            </label>
            <div className="flex items-center gap-2 p-1.5 bg-bento-bg border border-bento-border rounded-xl">
              <input
                type="text"
                readOnly
                value={url}
                className="flex-1 min-w-0 px-2 bg-transparent text-xs text-bento-text focus:outline-none font-mono"
              />
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold uppercase text-bento-text hover:text-white bg-bento-border hover:bg-bento-muted border border-bento-border/50 rounded-lg transition-all shrink-0 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-bento-accent" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-bento-accent" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 p-4 bg-bento-bg/40 border-t border-bento-border px-6 py-4">
          <Smartphone className="w-5 h-5 text-bento-accent shrink-0" />
          <div className="text-left">
            <p className="text-xs font-medium text-bento-text">Head Tracking Enabled</p>
            <p className="text-[10px] text-bento-muted leading-snug">
              Keep this screen open while holding your device or wearing compatible earbuds.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
