import { APP_ICON_SRC } from "../branding";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex h-[min(384px,90vmin)] w-[min(384px,90vmin)] items-center justify-center"
        aria-label="KamiCode splash screen"
      >
        <img
          alt="KamiCode"
          className="h-[min(256px,80vmin)] w-[min(256px,80vmin)] object-contain"
          src={APP_ICON_SRC}
        />
      </div>
    </div>
  );
}
