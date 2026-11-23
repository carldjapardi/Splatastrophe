"""DBW loader for PhotoTourism scenes prepared by prep_phototourism.py (no Nerfstudio needed)."""
from copy import deepcopy
from functools import cached_property

import numpy as np
import torch
from PIL import Image
from torch.utils.data.dataset import Dataset as TorchDataset
from torchvision.transforms import ToTensor

from utils import path_exists
from utils.path import DATASETS_PATH
from .bmvs import pytorch3d_KRT_from_proj


class PhototourismDataset(TorchDataset):
    name = 'phototourism'
    n_channels = 3

    def __init__(self, split, tag, **kwargs):
        kwargs = deepcopy(kwargs)
        self.split = split
        self.data_path = path_exists(DATASETS_PATH / 'phototourism' / tag)
        cam = np.load(self.data_path / 'cameras.npz')
        self.img_size = (int(cam['H']), int(cam['W']))
        self.names = [str(n) for n in cam['names']]
        N = len(self.names)
        self.view_ids = kwargs.pop('view_ids', list(range(N)))
        self.on_disk = kwargs.pop('on_disk', True)
        kwargs.pop('img_size', None)
        assert len(kwargs) == 0, kwargs

        P = [cam['K'][i] @ np.concatenate([cam['R'][i], cam['t'][i][:, None]], 1) for i in range(N)]
        self.KRT = [pytorch3d_KRT_from_proj(p, image_size=self.img_size) for p in P]
        self.pc_gt = torch.from_numpy(np.load(self.data_path / 'points.npy'))
        if self.on_disk and split == 'train':
            self.imgs = [self.load(i) for i in range(N)]

    def load(self, idx):
        return ToTensor()(Image.open(self.data_path / 'images' / self.names[idx]).convert('RGB'))

    def __len__(self):
        if self.split == 'train':
            return len(self.view_ids)
        elif self.split == 'val':
            return min(5, len(self.view_ids))
        return min(10, len(self.view_ids))

    def __getitem__(self, i):
        idx = self.view_ids[i]
        imgs = self.imgs[idx] if (self.on_disk and self.split == 'train') else self.load(idx)
        K, R, T = self.KRT[idx]
        out = {'imgs': imgs, 'K': K.float(), 'R': R.float(), 'T': T.float()}
        indices = torch.randperm(len(self.pc_gt))[:int(1e5)]
        return out, {'points': self.pc_gt[indices]}
