type ChatFabProps = {
  isOpen: boolean;
  onClick: () => void;
};

export default function ChatFab({ isOpen, onClick }: ChatFabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isOpen ? "채팅 패널 닫기" : "채팅 패널 열기"}
      aria-expanded={isOpen}
      className={[
        "fixed bottom-6 left-6 z-[2147483646] flex h-14 w-14 items-center justify-center",
        "rounded-full shadow-lg transition-all duration-300",
        "hover:scale-105 active:scale-95",
        isOpen
          ? "bg-slate-700 text-white rotate-0"
          : "bg-teal-600 text-white hover:bg-teal-500",
      ].join(" ")}
    >
      {isOpen ? (
        <CloseIcon />
      ) : (
        <ChatIcon />
      )}
    </button>
  );
}

function ChatIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-7 w-7"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.402.75.75 0 00-.197 1.477A49.144 49.144 0 0112 21.75a49.144 49.144 0 01-7.152-.52c-1.978-.292-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.678 3.348-3.97A48.901 48.901 0 0112 3.75c.817 0 1.63.03 2.435.09l-.087.021z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-6 w-6"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}
