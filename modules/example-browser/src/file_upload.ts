/*
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"). You may not use
 * this file except in compliance with the License. A copy of the License is
 * located at
 *
 *     http://aws.amazon.com/apache2.0/
 *
 * or in the "license" file accompanying this file. This file is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
 * implied. See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* This is a simple example of using a KMS Keyring
 * to encrypt and decrypt using the AWS Encryption SDK for Javascript in a browser.
 */

import {
  KmsKeyringBrowser,
  KMS,
  getClient,
  encrypt,
  decrypt
} from '@aws-crypto/client-browser'

import { S3 } from 'aws-sdk'

/* This is injected by webpack.
 * The webpack.DefinePlugin will replace the values when bundling.
 * The credential values are pulled from @aws-sdk/credential-provider-node
 * Use any method you like to get credentials into the browser.
 * See kms.webpack.config
 */
declare const credentials: {accessKeyId: string, secretAccessKey:string, sessionToken:string }

/* A KMS CMK is required to generate the data key.
 * You need kms:GenerateDataKey permission on the CMK in generatorKeyId.
 */
const generatorKeyId = 'arn:aws:kms:us-west-2:658956600833:alias/EncryptDecrypt'

/* Adding alternate KMS keys that can decrypt.
 * Access to kms:Encrypt is required for every CMK in keyIds.
 * You might list several keys in different AWS Regions.
 * This allows you to decrypt the data in any of the represented Regions.
 * In this example, I am using the same CMK.
 * This is *only* to demonstrate how the CMK ARNs are configured.
 */
const keyIds = ['arn:aws:kms:us-west-2:658956600833:key/b3537ef1-d8dc-4780-9f5a-55776cbb2f7f']

/* Need a client provider that will inject correct credentials.
 * The credentials here are injected by webpack from your environment bundle is created
 * The credential values are pulled using @aws-sdk/credential-provider-node.
 * See kms.webpack.config
 * You should inject your credential into the browser in a secure manner,
 * that works with your application.
 */
const { accessKeyId, secretAccessKey, sessionToken } = credentials

/* getClient takes a KMS client constructor
 * and optional configuration values.
 * The credentials can be injected here,
 * because browser do not have a standard credential discover process the way Node.js does.
 */
const clientProvider = getClient(KMS, {
  credentials: {
    accessKeyId,
    secretAccessKey,
    sessionToken
  }
})

/* The KMS keyring must be configured with the desired CMKs */
const keyring = new KmsKeyringBrowser({ clientProvider, generatorKeyId, keyIds })

/* Encryption context is a *very* powerful tool for controlling and managing access.
 * It is ***not*** secret!
 * Encrypted data is opaque.
 * You can use an encryption context to assert things about the encrypted data.
 * Just because you can decrypt something does not mean it is what you expect.
 * For example, if you are are only expecting data from 'us-west-2',
 * the origin can identify a malicious actor.
 * See: https://docs.aws.amazon.com/encryption-sdk/latest/developer-guide/concepts.html#encryption-context
 */
const encryptionContext = {
  stage: 'demo',
  purpose: 'simple demonstration app',
  origin: 'us-west-2'
}

/* The two top level functions to encrypt and decrypt a file.
 * These function expect the user to select a file from the local system,
 * that will then be read into the browser and either encrypted or decrypted
 * and then downloaded back to the local system.
 */
export const encryptFile = composeHtmlFileElement(composeCryptoTransform(encryptBuffer))
export const decryptFile = composeHtmlFileElement(composeCryptoTransform(decryptBuffer))

export const encryptFileToS3 = composeHtmlFileElement(function (file: File) {
  const Key = file.name
  return bufferFile(file)
    .then(encryptBuffer)
    .then(buffer => storeFileToS3(Key, buffer))
    .then(() => {})
})

export function decryptFileFromS3 (id: string) {
  return function handler() {
    // @ts-ignore
    const Key = document.getElementById(id).value
    return bufferFileFromS3(Key)
      .then(decryptBuffer)
      .then((data) => downloadBuffer(data, Key))
  }
}

/* Compose the HTML Input element that will have the `FileList`
 * with a transforming function.
 * The returned function can be used as an event handler.
 */
function composeHtmlFileElement(transformFile: (file: File) => Promise<void>) {
  return function (fileId: string) {
    return function handler() {
      // @ts-ignore
      const file = document.getElementById(fileId).files.item(0) as File
      transformFile(file)
    }
  }
}

function composeCryptoTransform(cryptoTransform: (buffer: Uint8Array) => Promise<Uint8Array>) {
  return  function transformFile(file: File) {
    const prefix = Math.random().toString().slice(2, 5)
    const name = `${prefix}_${file.name}`
    return bufferFile(file)
      .then(cryptoTransform)
      .then((data) => downloadBuffer(data, name))
  }
}

/* A simple function to read a File into a TypedArray */
export function bufferFile(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.addEventListener('load', () => resolve(new Uint8Array(<ArrayBuffer>fr.result)))
    fr.addEventListener('error', reject)
    fr.readAsArrayBuffer(file)
  })
}

/* Encrypt the data. */
export async function encryptBuffer (plainText: Uint8Array) {
  const { result } = await encrypt(keyring, plainText, { encryptionContext })

  return result
}

/* Decrypt the data. */
export async function decryptBuffer (data: Uint8Array) {
  const { plaintext, messageHeader } = await decrypt(keyring, data)

  /* Verify the encryption context.
   * If you use an algorithm suite with signing,
   * the Encryption SDK adds a name-value pair to the encryption context that contains the public key.
   * Because the encryption context might contain additional key-value pairs,
   * do not add a test that requires that all key-value pairs match.
   * Instead, verify that the key-value pairs you expect match.
   */
  Object
    .entries(encryptionContext)
    .forEach(([key, value]) => {
      if (messageHeader.encryptionContext[key] !== value) throw new Error('Encryption Context does not match expected values')
    })

  return plaintext
}

const s3 = new S3({ credentials: { accessKeyId, secretAccessKey, sessionToken } })
const Bucket = 'somenamethatijustmadeup'

export function storeFileToS3(Key: string, Body: Uint8Array) {
  return s3.putObject({ Body, Bucket, Key }).promise()
}

export function bufferFileFromS3(Key: string) {
  return s3.getObject({ Bucket, Key}).promise().then(({Body}) => <Uint8Array>Body)
}

/* Very simple way to download a file */
export function downloadBuffer(data: Uint8Array, fileName: string) {
  const type = 'application/octet-stream'
  const href = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = href
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()

  /* Blob URLs created from URL.createObjectURL should be released.
   * The browser will release them when the document is unloaded,
   * but if you expect the user to stay on this page for a long time,
   * you will need to manage the release of these objects.
   * see: https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL
   * Ideally, there would be an event tells us when the download is complete.
   * However such a clean event does not exist.
   * In https://w3c.github.io/FileAPI/#creating-revoking there is a note
   * "Requests that were started before the url was revoked should still succeed."
   * So after the download starts, revoking the URL is fine.
   * But when does the download start?
   * Reading https://url.spec.whatwg.org/#concept-url-parser #4,
   * when the href is assigned to the anchor,
   * the Blob URL _should_ be resolved and so 
   * I should be able revoke the URL.
   * 
   * also useful: https://github.com/whatwg/html/issues/954
   */
  setTimeout(() => {
    URL.revokeObjectURL(href)
  })
}
