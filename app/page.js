import AnnouncementBar from "@/components/landing/AnnouncementBar";
import Navbar from "@/components/landing/Navbar";
import HeroSection from "@/components/landing/HeroSection";
import TechStrip from "@/components/landing/TechStrip";
import FeaturesSection from "@/components/landing/FeaturesSection";
import CommitmentsSection from "@/components/landing/CommitmentsSection";
import ResearchBasisSection from "@/components/landing/ResearchBasisSection";
import FAQSection from "@/components/landing/FAQSection";
import CTASection from "@/components/landing/CTASection";
import Footer from "@/components/landing/Footer";
import LandingPageShell from "@/components/landing/LandingPageShell";

export default function HomePage() {
  return (
    <LandingPageShell>
      <AnnouncementBar />
      <Navbar />
      <main>
        <HeroSection />
        <TechStrip />
        <FeaturesSection />
        <CommitmentsSection />
        <ResearchBasisSection />
        <FAQSection />
        <CTASection />
      </main>
      <Footer />
    </LandingPageShell>
  );
}
