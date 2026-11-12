"use client";
import { useEffect, useRef, useId } from "react";
import { Icon } from "./icons";
export function Modal({
  title,
  children,
  onClose,
  className,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const titleId=useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={["modal", className].filter(Boolean).join(" ")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
