import React, { useState, useEffect, useRef } from 'react';

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallbackSrc?: string;
}

export const LazyImage: React.FC<LazyImageProps> = ({ src, fallbackSrc, className, alt, ...props }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '200px',
      }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const finalSrc = hasError && fallbackSrc ? fallbackSrc : src;

  return (
    <img
      ref={imgRef}
      src={isVisible ? finalSrc : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}
      alt={alt}
      className={className}
      onError={(e) => {
        if (!hasError && fallbackSrc) {
          setHasError(true);
        }
        if (props.onError) {
          props.onError(e);
        }
      }}
      {...props}
    />
  );
};

