'use strict';
// Email content. Every message has a plain-text part and a simple branded
// HTML part that renders in Gmail, Outlook and Apple Mail.
const { esc } = require('./html');

function shell(site, { heading, paragraphs, button, footnote }) {
  const p = (t) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#161A1A;">${t}</p>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#EDEFEC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEFEC;padding:32px 12px;font-family:'Barlow Semi Condensed','Segoe UI',Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#F8F9F7;border:1px solid #D0D6D1;border-radius:8px;">
<tr><td style="padding:22px 28px 0;font-size:22px;line-height:1;color:#161A1A;"><span style="color:#D55C13;">&#9650;</span>&nbsp;<strong>${esc(site)}</strong></td></tr>
<tr><td style="padding:22px 28px 8px;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;color:#161A1A;">${esc(heading)}</h1>
${paragraphs.map(p).join('\n')}
${button ? `<p style="margin:8px 0 22px;"><a href="${esc(button.href)}" style="display:inline-block;background:#D55C13;color:#0E1111;text-decoration:none;font-weight:700;font-size:16px;padding:12px 20px;border-radius:5px;">${esc(button.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#4F5755;">Or paste this address into your browser:<br><span style="word-break:break-all;color:#A8480C;">${esc(button.href)}</span></p>` : ''}
</td></tr>
${footnote ? `<tr><td style="padding:0 28px 24px;font-size:13px;line-height:1.5;color:#4F5755;border-top:1px solid #D0D6D1;padding-top:16px;">${footnote}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}

function passwordReset({ site, name, link, minutes, byAdmin }) {
  const hours = minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`;
  const intro = byAdmin
    ? `An administrator reset the password for your ${site} account. Your old password no longer works.`
    : `Someone asked to reset the password for your ${site} account. If that was you, choose a new password below.`;
  const footnote = byAdmin
    ? 'If you weren’t expecting this, contact your administrator.'
    : 'If you didn’t ask for this, ignore this email. Your password stays the same.';
  return {
    subject: `Reset your ${site} password`,
    text: `Hi ${name},\n\n${intro}\n\nChoose a new password here (the link works once, for ${hours}):\n${link}\n\n${footnote}\n`,
    html: shell(site, {
      heading: 'Reset your password',
      paragraphs: [`Hi ${esc(name)},`, esc(intro), `This link works once, for ${hours}.`],
      button: { label: 'Choose a new password', href: link },
      footnote: esc(footnote),
    }),
  };
}

function passwordChanged({ site, name, when, ip, link }) {
  const where = ip ? ` from ${ip}` : '';
  return {
    subject: `Your ${site} password was changed`,
    text: `Hi ${name},\n\nThe password for your ${site} account was changed ${when}${where}, and every other device was signed out.\n\nIf you didn't do this, reset your password right away: ${link}\n`,
    html: shell(site, {
      heading: 'Your password was changed',
      paragraphs: [`Hi ${esc(name)},`, `The password for your ${esc(site)} account was changed ${esc(when)}${esc(where)}, and every other device was signed out.`],
      footnote: `If you didn’t do this, <a href="${esc(link)}" style="color:#A8480C;">reset your password right away</a>.`,
    }),
  };
}

function accountApproved({ site, name, username, link }) {
  return {
    subject: `Your ${site} account is ready`,
    text: `Hi ${name},\n\nYour ${site} account (@${username}) was approved. You can sign in now:\n${link}\n`,
    html: shell(site, {
      heading: 'You’re in',
      paragraphs: [`Hi ${esc(name)},`, `Your ${esc(site)} account <strong>@${esc(username)}</strong> was approved. You can sign in now.`],
      button: { label: `Sign in to ${site}`, href: link },
    }),
  };
}

function testMessage({ site, name }) {
  return {
    subject: `${site} email test`,
    text: `Hi ${name},\n\nEmail from ${site} is working. Password reset links will arrive like this one.\n`,
    html: shell(site, {
      heading: 'Email is working',
      paragraphs: [`Hi ${esc(name)},`, `This is a test from ${esc(site)}. Password reset links and account notices will arrive like this one.`],
    }),
  };
}

module.exports = { passwordReset, passwordChanged, accountApproved, testMessage };
