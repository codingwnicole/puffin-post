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

  // The public profile card stays static when motion is reduced or the device is touch-first.
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var coarsePointer = window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches
  if (!reducedMotion && !coarsePointer) {
    document.querySelectorAll('[data-card-tilt]').forEach(function (card) {
      card.addEventListener('pointermove', function (event) {
        if (event.pointerType !== 'mouse') return
        var bounds = card.getBoundingClientRect()
        var x = (event.clientX - bounds.left) / bounds.width
        var y = (event.clientY - bounds.top) / bounds.height
        card.style.setProperty('--tilt-x', ((0.5 - y) * 8) + 'deg')
        card.style.setProperty('--tilt-y', ((x - 0.5) * 10) + 'deg')
        card.style.setProperty('--mx', (x * 100) + '%')
        card.style.setProperty('--my', (y * 100) + '%')
        card.style.setProperty('--shadow-x', ((0.5 - x) * 26) + 'px')
        card.style.setProperty('--shadow-y', (18 + y * 12) + 'px')
      })
      card.addEventListener('pointerleave', function () {
        ;['--tilt-x', '--tilt-y', '--mx', '--my', '--shadow-x', '--shadow-y'].forEach(function (property) { card.style.removeProperty(property) })
      })
    })
  }

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
    function showOverlay() { overlay.style.display = 'grid' }
    function hideOverlay() { overlay.style.display = 'none' }
    openBtn.addEventListener('click', showOverlay)
    if (closeBtn) closeBtn.addEventListener('click', hideOverlay)
    overlay.addEventListener('click', function (e) { if (e.target === overlay) hideOverlay() })
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.style.display !== 'none') hideOverlay() })
  }
})()
