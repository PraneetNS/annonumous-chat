"use client";

import React, { useEffect, useRef } from 'react';
import { ScreenProtectionManager } from '../security/screen-protection';

interface SecureCanvasProps {
    text: string;
    from: string;
    isMe: boolean;
    maxWidth?: number;
}

export const SecureCanvas: React.FC<SecureCanvasProps> = ({ text, from, isMe, maxWidth = 400 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (canvasRef.current) {
            ScreenProtectionManager.renderSecureText(canvasRef.current, text, {
                maxWidth,
                color: isMe ? "#ffffff" : "#e6edf3",
                backgroundColor: "transparent",
                font: "14px 'Inter', sans-serif",
                padding: 0
            });
        }
    }, [text, isMe, maxWidth]);

    return (
        <div className="secure-canvas-wrapper" style={{ position: 'relative' }}>
            <canvas
                ref={canvasRef}
                style={{
                    display: 'block',
                    maxWidth: '100%',
                    height: 'auto'
                }}
            />
            {/* Minimal overlay to prevent simple 'Inspect Element' text copying if OCR-ed */}
            <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                background: 'transparent',
                pointerEvents: 'none'
            }} />
        </div>
    );
};
