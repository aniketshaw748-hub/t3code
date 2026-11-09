import { BRAND } from "@t3tools/contracts/brand";
import type { SVGProps } from "react";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" overflow="visible" xmlns="http://www.w3.org/2000/svg">
      <text x="12" y="24" textAnchor="middle" fontSize="33" fontWeight="700" fill="currentColor">
        {BRAND.displayName.charAt(0)}
      </text>
    </svg>
  );
}
