import { useEffect, useState } from "react";
import DesktopController from "./components/DesktopController";
import MobilePlayer from "./components/MobilePlayer";

export default function App() {
  const [route, setRoute] = useState<"mixer" | "player">("mixer");

  useEffect(() => {
    // Basic route detection from URL pathname
    const path = window.location.pathname.toLowerCase();
    
    if (path.startsWith("/player")) {
      setRoute("player");
    } else {
      setRoute("mixer");
    }
  }, []);

  return (
    <div className="min-h-screen bg-bento-bg text-bento-text">
      {route === "player" ? (
        <MobilePlayer />
      ) : (
        <DesktopController />
      )}
    </div>
  );
}
