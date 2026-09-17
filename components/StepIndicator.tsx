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
  if (step === 'optimizing' || step === 'revamping') return 'instructions'
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
                className={`w-8 h-8 rounded-[8px] flex items-center justify-center text-sm font-black border-[1.6px] transition-all duration-300 ${
                  isCompleted
                    ? 'bg-[var(--color-accent)] border-[var(--color-ink)] text-[#0a0a0a] shadow-[2px_2px_0_0_var(--color-ink)]'
                    : isActive
                    ? 'bg-[var(--color-yellow)] border-[var(--color-ink)] text-[#0a0a0a] shadow-[2px_2px_0_0_var(--color-ink)]'
                    : 'border-[var(--color-border-soft)] text-[var(--color-text-faint)] bg-[var(--color-surface)]'
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
                className={`text-xs font-bold whitespace-nowrap ${
                  isActive || isCompleted ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'
                }`}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={`w-16 mb-5 border-t-2 transition-all duration-300 ${
                  i < currentIdx ? 'border-solid border-[var(--color-ink)]' : 'border-dotted border-[var(--color-text-faint)]'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}