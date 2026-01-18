SimplePasteImage is an extension which allows to automatically upload images when you copy-paste something on a wiki page in VisualEditor.

MediaWiki page: https://www.mediawiki.org/wiki/Extension:SimplePasteImage

It is a PoC for now. We havea big list to do:
* Avoid file duplicates
* Handle base64 images (we handle src only for now)
* Check behaviour on re-upload deletd file
* Error reporting
* Wait form
* What if img is a child of another element, and the last one contains smth useful? Currently we replace it. Need to do better.
* Remove some symbols from name (slashs? smth else?)
* Test paste when copy from local apps (Word?). Likely we cannot paste images in this case but
* Test older MWs (oldest supproted?). Looks like we can make it very generic (we need ot modify buffer only).
* Enable when pasting one file
* Fix image URLs, make it so image is not a link to its file
* Test what if copy-paste images from VE of the same wiki
* ...
* Ofc refactoring. Currently it is a mess, I wanted to see if the idea works at all
Nevertheless, it works in simple scenarios

## Simple demo
Simple gif to show how it works:
![SimplePasteImage](https://github.com/user-attachments/assets/a2a7d1c9-55e2-42f1-bfa6-73039d3640c5)
