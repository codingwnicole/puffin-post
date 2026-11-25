// ponytail: progressive enhancement for /c/<slug> and /embed pages
;(function () {
  'use strict'

  // Render from the public SVG rather than relying on an old R2 preview, which may
  // be missing after an edit or a previously blocked owner-side canvas export.
  function asData(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader()
      reader.onload = function () { resolve(String(reader.result)) }
      reader.onerror = function () { reject(new Error('Could not read the card image')) }
      reader.readAsDataURL(blob)
    })
  }
  function imageFrom(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image()
      image.onload = function () { resolve(image) }
      image.onerror = function () { reject(new Error('Could not draw the card')) }
      image.src = src
    })
  }
  var preparingPng = false
  document.querySelectorAll('[data-png-preview]').forEach(function (link) {
    link.addEventListener('click', async function (event) {
      event.preventDefault()
      if (preparingPng) return
      var preview = window.open('', '_blank')
      var status = document.querySelector('[data-png-status]')
      if (status) { status.hidden = false; status.textContent = 'Preparing PNG preview…' }
      if (!preview) { if (status) status.textContent = 'Allow popups to open the PNG preview, then try again.'; return }
      preview.opener = null
      preview.document.title = 'Card PNG preview'
      preview.document.body.textContent = 'Preparing PNG preview…'
      preparingPng = true
      try {
        var canvas = document.createElement('canvas')
        canvas.width = 1320; canvas.height = 860
        var context = canvas.getContext('2d')
        if (!context) throw new Error('This browser could not prepare the PNG')
        var sides = document.querySelectorAll('.public-card-face > svg')
        if (sides.length !== 2) throw new Error('Could not find both card sides')
        for (var i = 0; i < sides.length; i++) {
          var svg = sides[i].cloneNode(true)
          svg.setAttribute('width', '640'); svg.setAttribute('height', '860')
          var images = svg.querySelectorAll('image')
          for (var j = 0; j < images.length; j++) {
            var response = await fetch(images[j].getAttribute('href'))
            if (!response.ok) throw new Error('Could not load the card portrait. Please try again.')
            images[j].setAttribute('href', await asData(await response.blob()))
          }
          var svgData = await asData(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }))
          context.drawImage(await imageFrom(svgData), i * 680, 0, 640, 860)
        }
        var png = canvas.toDataURL('image/png')
        var image = preview.document.createElement('img')
        image.src = png; image.alt = 'Character card PNG preview'
        image.style.maxWidth = '100%'
        var download = preview.document.createElement('a')
        download.href = png; download.download = 'character-card.png'; download.textContent = 'Download PNG'
        preview.document.body.replaceChildren(download, image)
        if (status) status.textContent = 'PNG preview opened.'
      } catch (error) {
        preview.close()
        if (status) status.textContent = error.message || 'Could not prepare the PNG. Please try again.'
      } finally { preparingPng = false }
    })
  })

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
