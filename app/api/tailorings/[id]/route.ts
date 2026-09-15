import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/require-auth'
import { deleteTailoring, getTailoring } from '@/lib/db/tailorings'

type Params = { params: { id: string } }

/** One tailored copy from the signed-in user's history, with its job description and LaTeX. */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const tailoring = await getTailoring(auth.userId, params.id)
    if (!tailoring) return NextResponse.json({ error: 'Tailored resume not found' }, { status: 404 })
    return NextResponse.json({ tailoring })
  } catch (err) {
    console.error('[tailorings/:id] load failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'That tailored resume could not be loaded right now.' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!auth.userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const deleted = await deleteTailoring(auth.userId, params.id)
    if (!deleted) return NextResponse.json({ error: 'Tailored resume not found' }, { status: 404 })
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[tailorings/:id] delete failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'That tailored resume could not be deleted right now.' }, { status: 500 })
  }
}
