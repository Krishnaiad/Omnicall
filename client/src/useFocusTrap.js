import { useEffect, useRef } from 'react';

export function useFocusTrap(isOpen, onClose) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    
    // Store previous focused element to restore it on close
    const previousFocus = document.activeElement;
    
    const focusableElementsString = 'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex="0"], [contenteditable]';
    let focusableElements = [];
    
    if (modalRef.current) {
      focusableElements = Array.from(modalRef.current.querySelectorAll(focusableElementsString));
      if (focusableElements.length > 0) {
        // Focus first element on open
        focusableElements[0].focus();
      }
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
        return;
      }
      
      if (e.key === 'Tab') {
        if (!modalRef.current) return;
        
        // Refresh the list in case the DOM changed
        focusableElements = Array.from(modalRef.current.querySelectorAll(focusableElementsString));
        if (focusableElements.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
    };
  }, [isOpen, onClose]);

  return modalRef;
}
