import Image from 'next/image'

export function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-[#0a1329] transition-colors duration-300">
      <div className="flex flex-col items-center gap-1 animate-fade">
        <Image
          src="/mark-logo-color.png"
          alt="Logo"
          width={96}
          height={96}
          priority
        />
        <p className="text-gray-500 dark:text-gray-400 text-2xl tracking-[0.35em] font-normal uppercase transition-colors duration-300">
          LOADING
        </p>
      </div>
    </div>
  )
}
