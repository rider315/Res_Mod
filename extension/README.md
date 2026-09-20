# The Chills browser extension

Score your resume against the job posting you are looking at, save the job, and
start a tailoring in Chills — without copying a job description into another
window.

## What it does, and where

The extension is deliberately not a second copy of the app. It does the things
worth doing on the job page itself, and hands everything that needs a review
screen back to chills.pro:

| Where | What happens |
|---|---|
| **The panel** | Reads the posting, scores a resume against it, shows the keywords that are missing, saves the job |
| **chills.pro** | Tailoring, with every change shown next to the original; writing and sending recruiter email |

A 380-pixel side panel is no place to approve forty edits one by one, and the
app already does that well. The panel exists to answer the question you actually
have while standing on a posting: **is this worth an hour of my evening.**

## Loading it

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this `extension/` folder
4. Pin Chills to the toolbar, open a job posting, click the icon
5. Press **Connect Chills** and sign in

Chrome assigns an extension id on first load. It appears on the connect screen,
and it stays the same for this folder on this machine.

## Reading a posting

Three strategies, in the order they are trusted (`extract.js`):

1. **schema.org `JobPosting` JSON-LD.** Greenhouse, Lever, Workday, Indeed and
   most company career pages publish it, because Google for Jobs reads it. It is
   the only source that is both structured and maintained by the site.
2. **A selector for a board we know** — LinkedIn, Naukri, Indeed, Internshala,
   Wellfound. Exact, and certain to rot: these class names change without
   notice, which is why they come second.
3. **The page's own headings and its largest block of prose.** Ugly, and the
   difference between "works on any careers page" and "works on five sites until
   they redeploy".

The panel says which one was used. That line is not decoration — when a board
changes its markup and the text comes out wrong, it tells you which path to fix.

## What it can and cannot reach

The key the extension holds is scoped on the server, not here. Routes opt in to
accepting one (`lib/require-auth.ts`), and a test holds the rest to refusing it.

**Can:** read the posting on a page you have allowed, list your resumes, score
one against a job, save jobs and move them along.

**Cannot:** send email, connect a mailbox, buy anything, change a plan, reach
the owner's controls, delete your account — or mint another key, which would
let it outlive its own revocation.

Disconnect any time from **Account → Browser extension** on chills.pro. It stops
working immediately.

## How connecting works

`chrome.identity.launchWebAuthFlow` opens `/extension/connect` in a window this
code cannot read, and reports back only the address it landed on. Your Google
password is never near the extension. The key arrives in a URL **fragment**,
which no server and no proxy log ever sees, and Chrome hands it only to the
extension that asked.

The server checks the callback address before it offers anything, because that
check is the whole security of the flow: anyone can send someone to
`/extension/connect?redirect_uri=…`, and a page that obeys would give away an
account in one click. Only `https://<32 letters a–p>.chromiumapp.org/` is
accepted, with no query and no fragment of its own.

Set `CHILLS_EXTENSION_IDS` on the server to narrow it to the builds you publish.
Unset, any Chrome extension may ask, and the user's own click is the consent.

## Permissions, and why each one

| Permission | Why |
|---|---|
| `storage` | Keeping the key, per browser profile, where no page can read it |
| `identity` | The connect flow above |
| `sidePanel` | The panel itself |
| `scripting` + `activeTab` | Injecting the reader **on demand**. Nothing of this extension runs on any page until you open the panel and ask |
| `tabs` | Knowing which tab the panel is beside |
| host permissions | chills.pro, plus the job boards so they work without a prompt. Everything else is granted one site at a time, from the panel |

There are no persistent content scripts on purpose. A declared content script
runs on every page load whether or not anyone wanted it; this one runs when you
press a button.

Every call to Chills is made from the service worker, never from a page. A
content script shares a context with the page it is reading, and the key has no
business being anywhere near that.

## Pointing it at a dev server

From the panel's service worker console:

```js
chrome.runtime.sendMessage({ kind: 'setBaseUrl', payload: { url: 'http://localhost:3000' } })
```

Reconnect afterwards — a key is minted per origin. Send `{ url: '' }` to go back
to production.

## Files

```
manifest.json    Permissions, the side panel, the service worker
background.js    The key, every call to Chills, the message router
extract.js       Reading a posting off a page; injected, self-contained
sidepanel.html   The panel
sidepanel.css    The site's colours and typeface, bundled
sidepanel.js     Drawing answers; owns no logic worth the name
```
