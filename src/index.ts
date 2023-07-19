import { onBeforeUnmount, unref, watch, type CSSProperties } from 'vue'

import { mergeDefined, isSSR } from './utils'
import { CAPTURE_DELTA_FRAME_COUNT, defaultOptions } from './constants'

import type { UseFixedHeaderOptions, MaybeTemplateRef } from './types'

export function useFixedHeader(
   target: MaybeTemplateRef,
   options: Partial<UseFixedHeaderOptions> = defaultOptions
) {
   const mergedOptions = mergeDefined(defaultOptions, options)

   let resizeObserver: ResizeObserver | undefined = undefined
   let isListeningScroll = false
   let isInstantRestoration = true

   // Utils

   function getRoot() {
      if (isSSR) return null

      const root = unref(mergedOptions.root)
      if (root != null) return root

      return document.documentElement
   }

   function getScrollTop() {
      const root = getRoot()
      if (!root) return 0

      return root.scrollTop
   }

   function isFixed() {
      const el = unref(target)
      if (!el) return false

      const { position, display } = getComputedStyle(el)
      return (position === 'fixed' || position === 'sticky') && display !== 'none'
   }

   function getHeaderHeight() {
      const el = unref(target)
      if (!el) return 0

      let headerHeight = el.scrollHeight

      const { marginTop, marginBottom } = getComputedStyle(el)
      headerHeight += parseFloat(marginTop) + parseFloat(marginBottom)

      return headerHeight
   }

   function setStyles(styles: CSSProperties) {
      const el = unref(target)
      if (el) Object.assign(el.style, styles)
   }

   function removeStyles() {
      const el = unref(target)
      if (el) {
         const properties = [
            ...Object.keys({
               ...mergedOptions.enterStyles,
               ...mergedOptions.leaveStyles,
            }),
            'visibility',
         ]

         properties.forEach((prop) => el.style.removeProperty(prop))
      }
   }

   /**
    * Hides the header on page load/scroll restoration before it
    * has a chance to paint, only if scroll is instant.
    *
    * If not instant (smooth-scroll) 'isBelowHeader' will resolve
    * to false and the header will be visible until scroll is triggered.
    */
   function onInstantScrollRestoration() {
      if (!isInstantRestoration) return

      requestAnimationFrame(() => {
         const isBelowHeader = getScrollTop() > getHeaderHeight() * 1.2
         if (isBelowHeader) {
            setStyles({ ...mergedOptions.leaveStyles, visibility: 'hidden' })
         }
      })
      isInstantRestoration = false
   }

   function setAriaHidden() {
      unref(target)?.setAttribute('aria-hidden', 'true')
   }

   function removeAriaHidden() {
      unref(target)?.removeAttribute('aria-hidden')
   }

   function removeVisibility() {
      unref(target)?.style.removeProperty('visibility')
   }

   function onVisible() {
      removeAriaHidden()
      removeVisibility()
      setStyles({ ...mergedOptions.enterStyles })
   }

   function onHidden() {
      setAriaHidden()
      setStyles(mergedOptions.leaveStyles)
   }

   // Event handlers

   function createScrollHandler() {
      let captureEnterDelta = true
      let captureLeaveDelta = true

      let prevTop = 0

      function captureDelta(onCaptured: (value: number) => void) {
         let rafId: DOMHighResTimeStamp | undefined = undefined
         let frameCount = 0

         const startMs = performance.now()
         const startY = getScrollTop()

         function rafDelta() {
            const nextY = getScrollTop()

            if (frameCount === CAPTURE_DELTA_FRAME_COUNT) {
               onCaptured(Math.abs(startY - nextY) / (performance.now() - startMs))
               cancelAnimationFrame(rafId as DOMHighResTimeStamp)
            } else {
               frameCount++
               requestAnimationFrame(rafDelta)
            }
         }

         rafId = requestAnimationFrame(rafDelta)
      }

      return () => {
         const isTopReached = getScrollTop() <= getHeaderHeight()
         const isScrollingUp = getScrollTop() < prevTop
         const isScrollingDown = getScrollTop() > prevTop

         if (isTopReached) {
            onVisible()
         } else {
            if (prevTop > 0) {
               if (isScrollingUp && captureEnterDelta) {
                  captureEnterDelta = false

                  captureDelta((value) => {
                     if (value >= mergedOptions.enterDelta) {
                        onVisible()
                     }

                     captureEnterDelta = true
                  })
               } else if (isScrollingDown && captureLeaveDelta) {
                  captureLeaveDelta = false

                  captureDelta((value) => {
                     if (value >= mergedOptions.leaveDelta) {
                        onHidden()
                     }

                     captureLeaveDelta = true
                  })
               }
            }
         }

         prevTop = getScrollTop()
      }
   }

   const onScroll = createScrollHandler()

   function toggleFunctionalities() {
      const isValid = isFixed()

      if (isListeningScroll) {
         // If the header is not anymore fixed or sticky
         if (!isValid) {
            removeAriaHidden()
            removeStyles()
            toggleScollListener(true)
         }
         // If was not listening and now is fixed or sticky
      } else {
         if (isValid) toggleScollListener()
      }
   }

   function toggleScollListener(isRemove = false) {
      const root = getRoot()
      if (!root) return

      const scrollRoot = root === document.documentElement ? window : root
      const method = isRemove ? 'removeEventListener' : 'addEventListener'

      scrollRoot[method]('scroll', onScroll, { passive: true })

      isListeningScroll = !isRemove
   }

   let skipInitial = true

   function addResizeObserver() {
      resizeObserver = new ResizeObserver(() => {
         if (skipInitial) return (skipInitial = false)
         toggleFunctionalities()
      })

      const root = getRoot()
      if (root) resizeObserver.observe(root)
   }

   function resetListeners() {
      toggleScollListener(true)
      resizeObserver?.disconnect()
   }

   // Watchers

   watch(
      () => [unref(target), unref(mergedOptions.root)],
      (targetEl, _, onCleanup) => {
         if (isSSR) return

         if (targetEl) {
            /**
             * Resize listener is added in any case as it is
             * in charge of toggling the scroll listener if the header
             * turns from fixed/sticky to something else and viceversa.
             */
            addResizeObserver()
            if (!isFixed()) return

            /**
             * Immediately hides the header on page load, this has effect
             * only if scroll restoration is not smooth.
             */
            onInstantScrollRestoration()

            /**
             * Start listening scroll events, it will hide the header
             * in case of smooth-scroll restoration.
             */
            toggleFunctionalities()
         }

         onCleanup(resetListeners)
      },
      { immediate: true, flush: 'post' }
   )

   watch(mergedOptions.watch, toggleFunctionalities, { flush: 'post' })

   // Lifecycle

   onBeforeUnmount(resetListeners)
}
