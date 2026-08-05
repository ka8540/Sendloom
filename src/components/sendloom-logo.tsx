import Image from "next/image";

type SendloomLogoProps = {
  className?: string;
  size?: number;
  alt?: string;
};

// ponytail: every call site renders adjacent "Sendloom" wordmark text, so the
// mark defaults to decorative (alt=""). Pass alt="Sendloom" for icon-only use.
export function SendloomLogo({ className, size = 64, alt = "" }: SendloomLogoProps) {
  return (
    <Image
      src="/brand/sendloom-mark.png"
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{
        display: "block",
        objectFit: "contain",
        objectPosition: "center",
        margin: 0,
        transform: "none",
        verticalAlign: "middle"
      }}
      priority
    />
  );
}
