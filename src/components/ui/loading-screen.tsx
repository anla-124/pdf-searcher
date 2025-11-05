import Image from 'next/image'

export function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5f5f5]">
      <div className="flex flex-col items-center gap-1 animate-fade">
        <Image
          src="/mark-logo-color.png"
          alt="Logo"
          width={96}
          height={96}
          priority
        />
        <p className="text-[#6b7280] text-2xl tracking-[0.35em] font-normal uppercase">
          LOADING
        </p>
      </div>
    </div>
  )
}
