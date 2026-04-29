'use client'
import { AppStep } from '@/types/resume'

const STEPS: { id: AppStep; label: string }[] = [
  { id: 'input', label: 'Resume' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Export' },
]

function getDisplayStep(step: AppStep): AppStep {
  if (step === 'parsing') return 'input'
  if (step === 'optimizing') return 'instructions'
  if (step === 'applying') return 'review'
  return step
}

export default function StepIndicator({ currentStep }: { currentStep: AppStep }) {
  const currentDisplay = getDisplayStep(currentStep)
  const currentIdx = STEPS.findIndex((s) => s.id === currentDisplay)

  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, i) => {
        const isCompleted = i < currentIdx
        const isActive = step.id === currentDisplay
        const isLast = i === STEPS.length - 1

        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all duration-300 ${
                  isCompleted
                    ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white'
                    : isActive
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary-highlight)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] bg-[var(--color-surface)]'
                }`}
              >
                {isCompleted ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-xs font-medium whitespace-nowrap ${
                  isActive
                    ? 'text-[var(--color-primary)]'
                    : isCompleted
                    ? 'text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)]'
                }`}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={`w-16 h-0.5 mb-5 transition-all duration-300 ${
                  i < currentIdx ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}