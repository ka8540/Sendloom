"use client";

import { AlertCircle, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

type ShowErrorOptions = {
  durationMs?: number;
  title?: string;
};

type ErrorToast = {
  id: number;
  message: string;
  title: string;
};

type ErrorToastContextValue = {
  showError: (message: string, options?: ShowErrorOptions) => void;
};

const DEFAULT_DURATION_MS = 5200;
const DEFAULT_TITLE = "Something went wrong";

const ErrorToastContext = createContext<ErrorToastContextValue | null>(null);

export function ErrorToastProvider({ children }: { children: ReactNode }) {
  const nextIdRef = useRef(1);
  const timersRef = useRef(new Map<number, number>());
  const [toasts, setToasts] = useState<ErrorToast[]>([]);

  const dismissToast = useCallback((id: number) => {
    const timeoutId = timersRef.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timersRef.current.delete(id);
    }

    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showError = useCallback(
    (message: string, options?: ShowErrorOptions) => {
      const trimmedMessage = message.trim();
      if (!trimmedMessage) {
        return;
      }

      const id = nextIdRef.current++;
      const nextToast: ErrorToast = {
        id,
        message: trimmedMessage,
        title: options?.title?.trim() || DEFAULT_TITLE
      };

      setToasts((current) => [...current, nextToast].slice(-4));

      const timeoutId = window.setTimeout(() => {
        dismissToast(id);
      }, options?.durationMs ?? DEFAULT_DURATION_MS);

      timersRef.current.set(id, timeoutId);
    },
    [dismissToast]
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      timersRef.current.clear();
    };
  }, []);

  const contextValue = useMemo<ErrorToastContextValue>(
    () => ({
      showError
    }),
    [showError]
  );

  return (
    <ErrorToastContext.Provider value={contextValue}>
      {children}
      <div className="error-toast-viewport" aria-live="assertive" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className="error-toast" role="alert">
            <span className="error-toast__icon" aria-hidden="true">
              <AlertCircle />
            </span>
            <div className="error-toast__copy">
              <strong className="error-toast__title">{toast.title}</strong>
              <p className="error-toast__message">{toast.message}</p>
            </div>
            <button
              type="button"
              className="error-toast__dismiss"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ErrorToastContext.Provider>
  );
}

export function useErrorToast() {
  const context = useContext(ErrorToastContext);

  if (!context) {
    throw new Error("useErrorToast must be used within ErrorToastProvider.");
  }

  return context;
}

export function useErrorToastEffect(message: string | null | undefined, title?: string) {
  const { showError } = useErrorToast();
  const lastShownMessageRef = useRef<string | null>(null);

  useEffect(() => {
    if (!message) {
      lastShownMessageRef.current = null;
      return;
    }

    if (lastShownMessageRef.current === message) {
      return;
    }

    showError(message, { title });
    lastShownMessageRef.current = message;
  }, [message, showError, title]);
}

export function ErrorToastOnMount(props: { message?: string | null; title?: string }) {
  const { showError } = useErrorToast();
  const hasShownRef = useRef(false);

  useEffect(() => {
    if (hasShownRef.current || !props.message) {
      return;
    }

    hasShownRef.current = true;
    showError(props.message, { title: props.title });
  }, [props.message, props.title, showError]);

  return null;
}
