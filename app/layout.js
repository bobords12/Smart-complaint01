import { Manrope, Public_Sans } from "next/font/google";
import "./globals.css";
import Providers from "@/components/shared/Providers";

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-public-sans",
});

export const metadata = {
  title: {
    default:
      "Smart Complaint & Blotter Management System | Barangay Abuno, Iligan City",
    template: "%s | SCBMS",
  },
  description:
    "A capstone system digitizing complaint filing and blotter management for Barangay Halls with automatic NLP-based case categorization. Now piloting at Barangay Abuno, Iligan City.",
  keywords: [
    "complaint management",
    "blotter management",
    "barangay",
    "barangay abuno",
    "iligan city",
    "case categorization",
    "NLP",
  ],
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${manrope.variable} ${publicSans.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-light font-sans text-mirage antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
