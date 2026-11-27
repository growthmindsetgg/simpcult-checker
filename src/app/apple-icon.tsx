import { ImageResponse } from "next/og";

// the house chip from icon.svg, on the room's ink, for home screens
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const HEART_D =
  "M8 13.2S1 9 1 4.6C1 2.4 2.7.8 4.7.8c1.4 0 2.6.8 3.3 2 .7-1.2 1.9-2 3.3-2 2 0 3.7 1.6 3.7 3.8C15 9 8 13.2 8 13.2Z";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0610",
        }}
      >
        <svg width="140" height="140" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="15" fill="#5c1743" />
          <circle
            cx="16"
            cy="16"
            r="13"
            fill="none"
            stroke="#f1e4cc"
            strokeWidth="3"
            strokeDasharray="5.1 5.1"
            strokeDashoffset="2.55"
          />
          <circle cx="16" cy="16" r="10.2" fill="none" stroke="#d9a845" strokeWidth="0.8" />
          <path transform="translate(8.86 10.05) scale(.893)" fill="#ff3fae" d={HEART_D} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
