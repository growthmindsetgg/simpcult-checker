import type { Metadata } from "next";
import { VideoBg } from "@/components/VideoBg";
import { CheckerForm } from "./CheckerForm";
import { Reveal } from "@/components/motion";

export const metadata: Metadata = { title: "wl checker" };

export default function CheckerPage() {
  return (
    <>
      <VideoBg src="/media/lambedesign.mp4" brightness={0.5} />
      <section className="flex min-h-screen items-center justify-center px-5 py-32 md:py-44">
        <Reveal className="w-full max-w-md">
          <div className="glass p-8 md:p-10">
            <p className="t-eyebrow mb-4">mint list</p>
            <h1 className="t-h1 text-[clamp(30px,4vw,44px)]">check your eligibility</h1>
            <p className="t-lead mt-4">
              paste any monad wallet address. the list never leaves our server.
            </p>
            <CheckerForm />
          </div>
        </Reveal>
      </section>
    </>
  );
}
