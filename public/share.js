// ponytail: progressive enhancement for /c/<slug> and /embed pages
;(function () {
  'use strict'

  // Card flip: toggles data-flipped on the card container
  document.querySelectorAll('[data-card-flip]').forEach(function (button) {
    var target = document.getElementById(button.getAttribute('data-card-flip'))
    if (!target) return
    button.addEventListener('click', function () {
      var flipped = target.getAttribute('data-flipped') === 'true'
      target.setAttribute('data-flipped', flipped ? 'false' : 'true')
      button.setAttribute('aria-pressed', flipped ? 'false' : 'true')
    })
  })

  // Playlist click-to-load: replaces the button with the iframe from data-embed-src
  document.querySelectorAll('[data-playlist-load]').forEach(function (button) {
    button.addEventListener('click', function () {
      var container = button.closest('[data-playlist-container]')
      if (!container) return
      var src = container.getAttribute('data-embed-src')
      var height = container.getAttribute('data-embed-height') || '352'
      if (!src) return
      var iframe = document.createElement('iframe')
      iframe.src = src
      iframe.style.width = '100%'
      iframe.style.height = height + 'px'
      iframe.style.border = 'none'
      iframe.style.borderRadius = '8px'
      iframe.setAttribute('loading', 'lazy')
      iframe.setAttribute('allow', 'autoplay; clipboard-write; encrypted-media')
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox')
      container.innerHTML = ''
      container.appendChild(iframe)
    })
  })

  // View card overlay on public profile pages
  var overlay = document.getElementById('card-overlay')
  var openBtn = document.querySelector('[data-open-overlay]')
  var closeBtn = overlay && overlay.querySelector('[data-close-overlay]')
  if (overlay && openBtn) {
    openBtn.addEventListener('click', function () { overlay.hidden = false })
    if (closeBtn) closeBtn.addEventListener('click', function () { overlay.hidden = true })
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.hidden = true })
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !overlay.hidden) overlay.hidden = true })
  }
})()
