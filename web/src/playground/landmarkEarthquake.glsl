uniform vec4 uQuakeBaseHeight;
uniform vec3 uQuakeCell;
uniform float uQuakeHalfWidth;
uniform float uQuakeTime;

vec4 quakeRotation;
float quakeDust;

float quakeHash(vec3 cell, vec3 seed) {
    return fract(sin(dot(cell, seed)) * 43758.5453);
}

vec3 quakeTurn(vec4 rotation, vec3 offset) {
    vec3 t = 2.0 * cross(rotation.xyz, offset);
    return offset + rotation.w * t + cross(rotation.xyz, t);
}

void modifySplatCenter(inout vec3 center) {
    quakeRotation = vec4(0.0, 0.0, 0.0, 1.0);
    quakeDust = 0.0;
    vec3 local = center - uQuakeBaseHeight.xyz;
    float height = uQuakeBaseHeight.w;
    // A common ground motion ramps in before fragments begin to separate.
    float tremor = smoothstep(0.0, 0.45, uQuakeTime) * (1.0 - smoothstep(1.1, 2.6, uQuakeTime));
    vec2 shake = tremor * vec2(
        0.013 * sin(29.0 * uQuakeTime) + 0.005 * sin(47.0 * uQuakeTime),
        0.010 * sin(34.0 * uQuakeTime)
    ) * height;
    center.xy += shake;

    float foundation = 0.045 * height;
    if (local.z <= foundation) return;

    // Warped, staggered cells make contiguous fragments with irregular edges.
    vec3 grid = (local - vec3(0.0, 0.0, foundation)) / uQuakeCell;
    vec3 warp = 0.13 * sin(vec3(
        grid.z * 4.3 + grid.y * 1.8,
        grid.x * 3.4 + grid.z * 2.2,
        grid.x * 3.1 + grid.y * 2.7
    ));
    warp.x += 0.23 * sin(floor(grid.z) * 2.3);
    ivec3 index = ivec3(floor(grid + warp));
    index.z = max(0, index.z);
    vec3 cell = vec3(index);
    vec3 pivot = (cell + 0.5) * uQuakeCell + vec3(0.0, 0.0, foundation);

    float delay = quakeHash(cell, vec3(18.1, 9.2, 57.4));
    float drift = quakeHash(cell, vec3(12.9, 78.2, 37.7));
    float roll = quakeHash(cell, vec3(61.7, 15.6, 11.9));
    float elevation = clamp(pivot.z / height, 0.0, 1.0);
    float wave = clamp(pivot.x / (2.0 * uQuakeHalfWidth) + 0.5, 0.0, 1.0);
    float release = 1.05 + wave * 0.42 + elevation * 0.65 + delay * 0.24;
    float fallTime = max(0.0, uQuakeTime - release);
    if (fallTime == 0.0) {
        // The upper structure sways more than the foundation before release.
        center.xy += shake * 0.75 * clamp(local.z / height, 0.0, 1.0);
        return;
    }

    float drop = max(0.02 * height, pivot.z - height * (0.10 + 0.12 * elevation + 0.08 * delay));
    float gravity = 1.65 * height;
    float impactTime = sqrt(2.0 * drop / gravity);
    float airborne = min(fallTime, impactTime);
    float groundTime = max(0.0, fallTime - impactTime);
    float slide = groundTime / (1.0 + 4.8 * groundTime);
    float bounce = sin(3.14159 * clamp(groundTime / 0.26, 0.0, 1.0));
    float lift = 0.052 * gravity * impactTime * bounce;

    vec2 direction = normalize(vec2(2.0 * drift - 1.0, (roll < 0.48 ? -1.0 : 1.0) * (0.32 + delay)));
    float speed = height * (0.09 + 0.30 * elevation) * (0.7 + 0.6 * drift);
    // Hold a permanent rotated pose and taper the ground slide to a stop.
    float turn = smoothstep(0.0, impactTime + 0.40, fallTime);
    float angle = turn * (roll * 2.4 - 1.2 + (roll < 0.5 ? -0.46 : 0.46));
    vec3 axis = normalize(vec3(-direction.y, direction.x, drift - 0.5));
    quakeRotation = vec4(axis * sin(angle * 0.5), cos(angle * 0.5));

    vec3 offset = quakeTurn(quakeRotation, local - pivot);
    // The projected fragment extents keep most rubble above the ground plane.
    float bottom = min(pivot.z, dot(
        abs(quakeTurn(vec4(-quakeRotation.xyz, quakeRotation.w), vec3(0.0, 0.0, 1.0))),
        uQuakeCell * vec3(0.53, 0.53, 0.52)
    ));
    pivot.z = max(bottom, pivot.z - 0.5 * gravity * airborne * airborne + lift);
    center = uQuakeBaseHeight.xyz + pivot + offset;
    center.xy += shake + direction * speed * (airborne + slide);
    quakeDust = 0.13 * sin(3.14159 * clamp(groundTime / 0.65, 0.0, 1.0));
}

void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    rotation = quatMul(quakeRotation, rotation);
}

void modifySplatColor(vec3 center, inout vec4 color) {
    color.rgb = mix(color.rgb, vec3(0.50, 0.46, 0.40), quakeDust);
}
