import { useState } from "react";
import ChatFab from "./components/ChatFab";
import ChatPanel from "./components/ChatPanel";

export default function App() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <ChatFab isOpen={isOpen} onClick={() => setIsOpen((prev) => !prev)} />
      <ChatPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
