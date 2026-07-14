# Security Policy

## Supported Versions
| Version | Supported |
|---|---|
| latest (`main`) | ✅ |

## Scope
Grudgeball is a Devvit app that runs entirely on Reddit's own infrastructure —
the `devvit.json` fetch allowlist is empty (`http.enable: false`), all state
lives in Redis, and there is no external API surface. Most security-relevant
work is upstream in the Devvit platform itself; this policy covers the app code
in this repository (the Hono server routes, the placement transaction, and the
client).

## Reporting a Vulnerability
Please **do not** open a public issue for security vulnerabilities. Instead,
report them privately:

- Email **edy.cu@live.com**, or
- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security → Report a vulnerability).

You'll get an acknowledgment within 48 hours and a resolution timeline after
triage. Please give us a reasonable window to patch before public disclosure.

For vulnerabilities in the Devvit platform itself (not this app's code), report
them to Reddit per [Reddit's security policy](https://www.reddit.com/security).
