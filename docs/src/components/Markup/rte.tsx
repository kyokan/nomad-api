import React from "react";
import marked from "marked";
import * as DOMPurify from "dompurify";
import {messageHash} from "ddrp-indexer/dist/crypto/hash";
const hljs = require('highlight.js');

const renderer = new marked.Renderer({
  pedantic: false,
  gfm: true,
  breaks: true,
  sanitize: true,
  smartLists: true,
  smartypants: false,
  xhtml: false,
});

renderer.link = (href: string, title: string, text: string, level: number = 0): string => {
  try {
    const {protocol} = new URL(href);
    const url = href.replace(`${protocol}//`, '');
    const linkText = url.length > 48
      ? url.slice(0, 48) + '...'
      : url;
    return `<a href="${href}" title="${text || href}" target="_blank">${text || title || linkText}</a>`
  } catch (e) {
    //
    return '';
  }
};

renderer.image = (href: string, title: string, text: string, level: number = 0): string => {
  try {
    const {protocol} = new URL(href);
    const url = href.replace(`${protocol}//`, '');
    const linkText = url.length > 48
      ? url.slice(0, 48) + '...'
      : url;

    return `<a href="${href}" title="${text || href}" target="_blank">${title || linkText}</a>`
  } catch (e) {
    //
    return '';
  }
};

const MARKUP_CACHE: {
  [contentHash: string]: string;
} = {};

renderer.html = (html: string): string => {
  const contentHash = messageHash(html, '');

  if (MARKUP_CACHE[contentHash]) {
    return MARKUP_CACHE[contentHash];
  }

  const parser = new DOMParser();
  const dom = parser.parseFromString(html, 'text/html');
  const returnHTML = Array.prototype.map
    .call(dom.body.childNodes, el => {
      return el.dataset.imageFileHash
        ? el.outerHTML
        : el.innerText;
    })
    .join('');
  MARKUP_CACHE[contentHash] = returnHTML;
  return returnHTML;
};

export function markup(content: string): string {
  let html = '';

  if (content) {
    const contentHash = messageHash(content, '');

    if (MARKUP_CACHE[contentHash]) {
      html = MARKUP_CACHE[contentHash];
    } else {
      const dirty = marked(content, {
        renderer,
        highlight: function (str: string, lang: string) {
          if (lang && hljs.getLanguage(lang)) {
            try {
              return hljs.highlight(lang, str).value;
            } catch (err) {
              //
            }
          }

          try {
            return hljs.highlightAuto(str).value;
          } catch (err) {
            //
          }

          return ''; // use external default escaping
        }
      });

      html = DOMPurify.sanitize(dirty);
      MARKUP_CACHE[contentHash] = html;
    }
  }

  return html;
}
