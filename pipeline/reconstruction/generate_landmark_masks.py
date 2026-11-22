"""Generate candidate landmark masks and a contact sheet for human review."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
import torch
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor, SamModel, SamProcessor


def generate(source, output, prompt, detail, limit, device):
    metadata = json.loads((source / 'transforms.json').read_text())
    names = sorted(metadata['train_filenames'])
    if not names or len({Path(name).stem for name in names}) != len(names):
        raise ValueError('Training photos must have unique filename stems')
    if limit and limit < len(names):
        names = [names[index] for index in np.linspace(0, len(names) - 1, limit, dtype=int)]
    output.mkdir(parents=True, exist_ok=False)
    prompts = [prompt] + ([detail, 'statue'] if detail else [])
    # Using two searches lets the roof sculpture get its own prompt box.
    detector_id, sam_id = 'IDEA-Research/grounding-dino-tiny', 'facebook/sam-vit-base'
    detector_processor = AutoProcessor.from_pretrained(detector_id)
    detector = AutoModelForZeroShotObjectDetection.from_pretrained(detector_id).to(device).eval()
    sam_processor = SamProcessor.from_pretrained(sam_id)
    sam = SamModel.from_pretrained(sam_id).to(device).eval()
    report = []
    tiles = []

    @torch.inference_mode()
    def mask_for(photo):
        boxes = []
        for index, text in enumerate(prompts):
            if index == 2 and len(boxes) == 2:
                break
            inputs = detector_processor(images=photo, text=text.rstrip('.') + '.', return_tensors='pt').to(device)
            result = detector_processor.post_process_grounded_object_detection(
                detector(**inputs), inputs.input_ids, threshold=.25 if index == 0 else .20, text_threshold=.23,
                target_sizes=[(photo.height, photo.width)]
            )[0]
            if len(result['scores']):
                boxes.append(result['boxes'][result['scores'].argmax()].tolist())
            elif not boxes:
                return None
        inputs = sam_processor(photo, input_boxes=[boxes], return_tensors='pt').to(device)
        pred = sam(**inputs)
        candidates = sam_processor.image_processor.post_process_masks(
            pred.pred_masks.cpu(), inputs.original_sizes.cpu(), inputs.reshaped_input_sizes.cpu()
        )[0]
        union = torch.zeros((photo.height, photo.width), dtype=torch.bool)
        for masks, scores in zip(candidates, pred.iou_scores[0].cpu()):
            union |= masks[scores.argmax()]
        return union.numpy()

    for name in names:
        with Image.open(source / name) as original:
            photo = original.convert('RGB')
        mask = mask_for(photo)
        coverage = float(mask.mean()) if mask is not None else 0.0
        accepted = .01 < coverage < .95
        if accepted:
            Image.fromarray(mask.astype(np.uint8) * 255).save(output / f'{Path(name).stem}.png')
        report.append({'image': name, 'foreground_fraction': coverage, 'written': accepted})
        print(f'{name}: {coverage:.1%} foreground' if accepted else f'{name}: review required', flush=True)
        if len(tiles) < 16:
            tile = Image.new('RGB', (300, 245), '#151820')
            preview = photo.copy()
            if mask is not None:
                hidden = Image.fromarray((~mask).astype(np.uint8) * 155)
                preview.paste((23, 32, 47), mask=hidden)
            preview.thumbnail((300, 215))
            tile.paste(preview, ((300-preview.width)//2, 0))
            ImageDraw.Draw(tile).text((8, 220), f'{len(report):02d}  {coverage:.1%}', fill='white')
            tiles.append(tile)
    if tiles:
        sheet = Image.new('RGB', (1200, 245 * ((len(tiles) + 3)//4)), '#151820')
        for i, tile in enumerate(tiles):
            sheet.paste(tile, (300*(i % 4), 245*(i // 4)))
        sheet.save(output / 'contact-sheet.jpg', quality=90)
    (output / 'manifest.json').write_text(json.dumps({
        'detector': detector_id, 'segmenter': sam_id, 'prompts': prompts,
        'status': 'automatic candidates; review before use', 'images': report
    }, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--prompt', required=True)
    parser.add_argument('--detail')
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--device', default='cuda')
    args = parser.parse_args()
    if args.limit < 0:
        parser.error('--limit must be nonnegative')
    generate(args.source, args.output, args.prompt, args.detail, args.limit, args.device)
