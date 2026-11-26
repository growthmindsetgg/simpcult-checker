import { Hero } from "@/components/home/Hero";
import { Earn, House, Lore, Portraits, Finale } from "@/components/home/Sections";

export default function Home() {
  return (
    <>
      <Hero />
      <Earn />
      <House />
      <Lore />
      <Portraits />
      <Finale />
    </>
  );
}
