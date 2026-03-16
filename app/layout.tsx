import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "AFSM — Autonomous Flight Safety Monitor",
    description: "Autonomous Flight Safety Monitor powered by NVIDIA Nemotron",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
