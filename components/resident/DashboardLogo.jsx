import Image from "next/image";

export default function DashboardLogo({ compact = false }) {
  return (
    <div className="flex flex-col items-center text-center">
      <Image
        src="/Abunoi.jpg"
        alt="Official seal of Barangay Abuno"
        width={96}
        height={96}
        className={`rounded-full object-contain drop-shadow-lg ${
          compact ? "h-10 w-10" : "h-20 w-20 sm:h-24 sm:w-24"
        }`}
      />

      <h1
        className={`font-heading font-bold tracking-tight text-white ${
          compact ? "text-sm" : "mt-3 text-lg"
        }`}
      >
        BARANGAY ABUNO
      </h1>

      {!compact ? (
        <>
          <p className="text-sm text-white/90">ILIGAN CITY</p>
          <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/90">
            Smart Governance
          </p>
        </>
      ) : null}
    </div>
  );
}