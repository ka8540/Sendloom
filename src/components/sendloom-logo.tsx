import Image from "next/image";

type SendloomLogoProps = {
  className?: string;
  size?: number;
};

// ponytail: every call site renders adjacent "Sendloom" wordmark text, so the
// mark is always decorative (alt=""). Pass a real alt if used standalone.
export function SendloomLogo({ className, size = 64 }: SendloomLogoProps) {
  return (
    <Image
      src="/brand/sendloom-mark.png"
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain" }}
      priority
    />
  );
}
