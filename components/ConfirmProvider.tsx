'use client'
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { Trash } from '@/components/brand/Icons'
import Dialog from '@/components/brand/Dialog'
import { primaryButton, secondaryButton } from '@/components/user/shared'

/**
 * Asking before something irreversible, in Chills's own dialog.
 *
 * The browser's confirm() was doing this: an unstyled grey box headed
 * "chills.pro says", which looks like something went wrong rather than like the
 * app asking a question. It also blocks the whole page, so nothing behind it can
 * paint while it is open.
 *
 * `confirm()` returns a promise, so a call site reads almost the way it did:
 *
 *     if (!(await confirm({ title: 'Delete this draft?' }))) return
 */

export interface ConfirmRequest {
  title: string
  /** What it means, when the title alone doesn't say. */
  body?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Something is destroyed: the button turns red and the cancel takes focus. */
  danger?: boolean
}

type Ask = (request: ConfirmRequest) => Promise<boolean>

const ConfirmContext = createContext<Ask | null>(null)

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext)
  if (!ask) throw new Error('useConfirm needs <ConfirmProvider> above it')
  return ask
}

export default function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  /** The waiting promise's resolve, held until a button is pressed. */
  const answer = useRef<((ok: boolean) => void) | null>(null)

  const ask = useCallback<Ask>(
    (next) =>
      new Promise((resolve) => {
        // An earlier question still waiting is answered no, so nothing hangs.
        answer.current?.(false)
        answer.current = resolve
        setRequest(next)
      }),
    []
  )

  /**
   * Where focus starts: on Cancel when something is about to be destroyed, so
   * Enter can't do it by accident, and on the confirm button otherwise.
   */
  const cancelButton = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)

  const close = useCallback((ok: boolean) => {
    setRequest(null)
    const resolve = answer.current
    answer.current = null
    resolve?.(ok)
  }, [])

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {request && (
        <Dialog
          title={request.title}
          icon={request.danger ? <Trash size={18} /> : undefined}
          width="max-w-md"
          initialFocus={request.danger ? cancelButton : confirmButton}
          onClose={() => close(false)}
          footer={
            <>
              <button ref={cancelButton} onClick={() => close(false)} className={secondaryButton}>
                {request.cancelLabel ?? 'Cancel'}
              </button>
              <button
                ref={confirmButton}
                onClick={() => close(true)}
                className={
                  request.danger
                    ? 'nb-btn py-2.5 px-5 text-sm bg-[var(--color-error)] text-white border-[var(--color-ink)]'
                    : primaryButton
                }
              >
                {request.confirmLabel ?? (request.danger ? 'Delete' : 'Continue')}
              </button>
            </>
          }
        >
          {request.body ? (
            <div className="text-sm leading-relaxed text-[var(--color-text-muted)]">{request.body}</div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">This can’t be undone.</p>
          )}
        </Dialog>
      )}
    </ConfirmContext.Provider>
  )
}
