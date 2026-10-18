// Draws the app icon and the launch-screen mark from the same geometry as the
// masthead logo in index.html: five vertebrae in a gentle S on a blue tile, the
// one at the apex of the curve in marker red.
//
//   cd ios && swift tools/make-icons.swift
//
// Writes into Versine/Assets.xcassets, relative to the current directory. Run it again if the mark changes.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Vertebra { let x, y, w, h, dx, deg: CGFloat; let apex: Bool }

// The <rect class="mark__v"> elements, in the logo's 32-unit viewBox.
let spine: [Vertebra] = [
    .init(x: 12.5, y: 5.25, w: 7.0, h: 3.5, dx: 0, deg: -5.6, apex: false),
    .init(x: 12.2, y: 9.75, w: 7.6, h: 3.5, dx: 2.2, deg: 0, apex: true),
    .init(x: 11.9, y: 14.25, w: 8.2, h: 3.5, dx: 0, deg: 5.6, apex: false),
    .init(x: 11.6, y: 18.75, w: 8.8, h: 3.5, dx: -2.2, deg: 0, apex: false),
    .init(x: 11.3, y: 23.25, w: 9.4, h: 3.5, dx: 0, deg: -5.6, apex: false),
]

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

/// `rounded` draws the tile with the logo's own corner radius (the launch mark);
/// the app icon is a full square, because iOS applies its own mask.
func draw(size: Int, rounded: Bool) -> CGImage {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let s = CGFloat(size) / 32
    // SVG coordinates: origin top left, y down.
    ctx.translateBy(x: 0, y: CGFloat(size))
    ctx.scaleBy(x: s, y: -s)

    let tile = CGRect(x: 0, y: 0, width: 32, height: 32)
    ctx.saveGState()
    if rounded {
        ctx.addPath(CGPath(roundedRect: tile, cornerWidth: 9, cornerHeight: 9, transform: nil))
        ctx.clip()
    }
    let gradient = CGGradient(colorsSpace: space, colors: [color(0x2A7FA0), color(0x0E2230)] as CFArray,
                              locations: [0, 1])!
    ctx.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 32, y: 32), options: [])
    ctx.restoreGState()

    for v in spine {
        let cx = v.x + v.w / 2 + v.dx
        let cy = v.y + v.h / 2
        ctx.saveGState()
        ctx.translateBy(x: cx, y: cy)
        ctx.rotate(by: v.deg * .pi / 180)
        let rect = CGRect(x: -v.w / 2, y: -v.h / 2, width: v.w, height: v.h)
        ctx.addPath(CGPath(roundedRect: rect, cornerWidth: 1.75, cornerHeight: 1.75, transform: nil))
        ctx.setFillColor(v.apex ? color(0xD6402A) : color(0xFFFFFF))
        ctx.fillPath()
        ctx.restoreGState()
    }
    return ctx.makeImage()!
}

func write(_ image: CGImage, to path: String) {
    let url = URL(fileURLWithPath: path)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { fatalError("could not write \(path)") }
    print("wrote \(path)")
}

let assets = FileManager.default.currentDirectoryPath + "/Versine/Assets.xcassets"
guard FileManager.default.fileExists(atPath: assets) else { fatalError("run this from the ios/ directory") }

write(draw(size: 1024, rounded: false), to: "\(assets)/AppIcon.appiconset/AppIcon.png")
for scale in [1, 2, 3] {
    write(draw(size: 88 * scale, rounded: true), to: "\(assets)/LaunchMark.imageset/LaunchMark@\(scale)x.png")
}
