varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

void main()
{
    // Position
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * modelPosition;

    // Model normal (w = 0.0 so translation is ignored)
    vec4 modelNormal = modelMatrix * vec4(normal, 0.0);

    // Varyings
    vUv = uv;
    vNormal = modelNormal.xyz;
    vPosition = modelPosition.xyz;
}
