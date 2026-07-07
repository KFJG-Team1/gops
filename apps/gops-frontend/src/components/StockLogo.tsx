import { useEffect, useMemo, useState } from "react";
import { buildStockLogoUrl, shouldShowLogoDevAttribution, stockLogoInitials } from "../market/stockLogo";

type StockLogoSize = "xs" | "sm" | "md" | "lg";

type StockLogoProps = {
  symbol: string;
  companyName?: string;
  size?: StockLogoSize;
  className?: string;
};

export function StockLogo({ symbol, companyName, size = "sm", className }: StockLogoProps) {
  const imageUrl = useMemo(() => buildStockLogoUrl(symbol, { size: logoPixelSize(size) }), [size, symbol]);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const fallbackLabel = stockLogoInitials(symbol);
  const showImage = Boolean(imageUrl && failedImageUrl !== imageUrl);

  useEffect(() => {
    setFailedImageUrl(null);
  }, [imageUrl]);

  return (
    <span
      className={[
        "stock-logo",
        `stock-logo-${size}`,
        showImage ? "has-image" : "has-fallback",
        className
      ].filter(Boolean).join(" ")}
      aria-hidden="true"
      title={companyName ? `${companyName} logo` : `${symbol.toUpperCase()} logo`}
    >
      {showImage ? (
        <img
          src={imageUrl ?? undefined}
          alt=""
          loading="lazy"
          referrerPolicy="origin"
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        <span>{fallbackLabel}</span>
      )}
    </span>
  );
}

export function LogoDevAttribution({ className }: { className?: string }) {
  if (!shouldShowLogoDevAttribution()) {
    return null;
  }
  return (
    <a
      className={["logo-dev-attribution", className].filter(Boolean).join(" ")}
      href="https://logo.dev"
      target="_blank"
      rel="noopener"
    >
      Logos provided by Logo.dev
    </a>
  );
}

function logoPixelSize(size: StockLogoSize): number {
  switch (size) {
    case "xs":
      return 32;
    case "md":
      return 64;
    case "lg":
      return 96;
    default:
      return 48;
  }
}
