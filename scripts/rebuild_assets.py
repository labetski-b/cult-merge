
import os
import glob
import shutil
import collections
from PIL import Image

SOURCE_DIR = "/Users/labetsky/.gemini/antigravity/brain/77813751-ef5a-47de-b844-f5a13d65fcad"
DEST_DIR = "/Users/labetsky/Documents/AI/PROJECTS/CULT.MERGE/src/assets"

# Mapping: (SourceKey, DestSubdir, DestName, ResizeSize)
ASSETS = [
    ("spider_lvl1", "creatures", "spider_lvl1.png", 85),
    ("spider_lvl2", "creatures", "spider_lvl2.png", 85),
    ("spider_lvl3", "creatures", "spider_lvl3.png", 85),
    ("slime_lvl1", "creatures", "slime_lvl1.png", 85),
    ("slime_lvl2", "creatures", "slime_lvl2.png", 85),
    ("slime_lvl3", "creatures", "slime_lvl3.png", 85),
    ("snake_lvl1", "creatures", "snake_lvl1.png", 85),
    ("snake_lvl2", "creatures", "snake_lvl2.png", 85),
    ("snake_lvl3", "creatures", "snake_lvl3.png", 85),
    ("spider_lvl4", "creatures", "spider_lvl4.png", 85),
    ("spider_lvl5", "creatures", "spider_lvl5.png", 85),
    ("slime_lvl4", "creatures", "slime_lvl4.png", 85),
    ("slime_lvl5", "creatures", "slime_lvl5.png", 85),
    ("snake_lvl4", "creatures", "snake_lvl4.png", 85),
    ("snake_lvl5", "creatures", "snake_lvl5.png", 85),
    
    ("gen_flesh_lvl1", "generators", "gen_flesh_lvl1.png", 128),
    ("gen_flesh_lvl2", "generators", "gen_flesh_lvl2.png", 128),
    ("gen_flesh_lvl3", "generators", "gen_flesh_lvl3.png", 128),
    ("gen_flesh_lvl4", "generators", "gen_flesh_lvl4.png", 128),
    ("gen_flesh_lvl5", "generators", "gen_flesh_lvl5.png", 128),
    ("gen_slime_lvl1", "generators", "gen_slime_lvl1.png", 128),
    ("gen_slime_lvl2", "generators", "gen_slime_lvl2.png", 128),
    ("gen_slime_lvl3", "generators", "gen_slime_lvl3.png", 128),
    ("gen_slime_lvl4", "generators", "gen_slime_lvl4.png", 128),
    ("gen_slime_lvl5", "generators", "gen_slime_lvl5.png", 128),
    
    ("rune_blue_small", "runes", "rune_blue_small.png", 85),
    ("rune_blue_large", "runes", "rune_blue_large.png", 85),
    ("rune_red_small", "runes", "rune_red_small.png", 85),
    ("rune_red_large", "runes", "rune_red_large.png", 85),
    ("rune_hard_small", "runes", "rune_hard_small.png", 85),
    ("rune_hard_large", "runes", "rune_hard_large.png", 85),
    
    ("res_meat", "resources", "meat.png", 64),
    ("res_eyes", "resources", "eyes.png", 64),
    ("res_gems", "resources", "gems.png", 64),
    ("res_rune1", "resources", "rune1.png", 64),
    ("res_rune2", "resources", "rune2.png", 64),
    
    ("kraken_boss", "kraken", "kraken_boss.png", 256),
]

def remove_background(img, tolerance=30):
    img = img.convert("RGBA")
    width, height = img.size
    pixels = img.load()
    
    # Identify background from corners and borders
    border_pixels = []
    # Sample top/bottom rows
    for x in range(width):
        border_pixels.append(pixels[x, 0])
        border_pixels.append(pixels[x, height - 1])
    # Sample left/right cols
    for y in range(height):
        border_pixels.append(pixels[0, y])
        border_pixels.append(pixels[width - 1, y])
            
    counter = collections.Counter(border_pixels)
    total_border = len(border_pixels)
    
    # Heuristic: Take most common colors (>5%) as background
    bg_colors = set()
    for color, count in counter.most_common(5):
        if count / total_border > 0.05:
            bg_colors.add(color)

    if not bg_colors:
        return img

    def is_bg(c):
        # Distance check for tolerance
        for bg in bg_colors:
            dist = sum(abs(c[i] - bg[i]) for i in range(3)) # Ignore alpha for diff
            if dist < tolerance:
                return True
        return False

    # Flood fill
    queue = []
    visited = set()
    
    # Init queue with border pixels matching bg
    for x in range(width):
        if is_bg(pixels[x, 0]):
            queue.append((x, 0))
            visited.add((x, 0))
        if is_bg(pixels[x, height - 1]):
            queue.append((x, height - 1))
            visited.add((x, height - 1))
    
    for y in range(height):
        if is_bg(pixels[0, y]):
            queue.append((0, y))
            visited.add((0, y))
        if is_bg(pixels[width - 1, y]):
            queue.append((width - 1, y))
            visited.add((width - 1, y))

    if not queue:
        # Fallback: corners only
        corners = [(0,0), (width-1, 0), (0, height-1), (width-1, height-1)]
        for c in corners:
            if is_bg(pixels[c[0], c[1]]):
                queue.append(c)
                visited.add(c)

    while queue:
        x, y = queue.pop(0) # BFS
        pixels[x, y] = (0, 0, 0, 0)
        
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]:
                if dx == 0 and dy == 0: continue
                nx, ny = x + dx, y + dy
                
                if 0 <= nx < width and 0 <= ny < height:
                    if (nx, ny) not in visited:
                        if is_bg(pixels[nx, ny]):
                            visited.add((nx, ny))
                            queue.append((nx, ny))
    return img

def process_assets():
    for key, subdir, name, size in ASSETS:
        # Priority 1: Check for _flat version (solid background)
        pattern_flat = os.path.join(SOURCE_DIR, f"{key}_flat*.png")
        matches_flat = glob.glob(pattern_flat)
        
        # Priority 2: Standard version
        pattern_std = os.path.join(SOURCE_DIR, f"{key}*.png")
        matches_std = glob.glob(pattern_std)
        
        source_path = None
        is_flat = False
        
        if matches_flat:
            matches_flat.sort(key=os.path.getmtime, reverse=True)
            source_path = matches_flat[0]
            is_flat = True
        elif matches_std:
            matches_std.sort(key=os.path.getmtime, reverse=True)
            source_path = matches_std[0]
            
        if not source_path:
            print(f"Missing source for {key}")
            continue
            
        target_dir = os.path.join(DEST_DIR, subdir)
        os.makedirs(target_dir, exist_ok=True)
        target_path = os.path.join(target_dir, name)
        
        print(f"Processing {key} -> {name} (Flat: {is_flat})")
        
        try:
            img = Image.open(source_path)
            
            # Remove background (on the original size)
            # If flat, we assume white/solid background and use stricter tolerance
            if is_flat:
                # For generated "solid white", simple corner logic works best
                img = remove_background(img, tolerance=60) 
            else:
                img = remove_background(img, tolerance=30)
            
            # Resize
            img = img.resize((size, size), Image.Resampling.NEAREST)
            
            img.save(target_path)
        except Exception as e:
            print(f"Error processing {key}: {e}")

if __name__ == "__main__":
    process_assets()
